#!/usr/bin/env node
// CLI selector with gradient header and interactive menu

const figlet = require('figlet');
const gradient = require('gradient-string');
const { Select, Input } = require('enquirer');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const marked = require('marked');
const chalk = require('chalk');
const fs = require('fs');

const CONTROL_HOST = '127.0.0.1';
const CONTROL_PORT = 50002;
const CONTROL_BASE = `http://${CONTROL_HOST}:${CONTROL_PORT}`;

const args = process.argv.slice(2);
const noColor = args.includes('--no-color') || process.env.NO_COLOR !== undefined;

function renderHeader(text) {
    // Build header via Doh FIGlet font (fallback to Standard). Use uppercase preserved hyphen.
    const raw = String(text || '').toUpperCase();
    let fig;
    try {
        fig = figlet.textSync(raw, { font: 'Doh', horizontalLayout: 'fitted' });
    } catch (e) {
        try {
            fig = figlet.textSync(raw, { font: 'Standard' });
        } catch (e2) {
            fig = raw;
        }
    }

    if (noColor || !process.stdout.isTTY) {
        try { return require('chalk').bold(fig); } catch (e) { return fig; }
    }

    try {
        // Neom (neon-like) palette: electric green -> aqua -> electric blue -> violet -> magenta
        const neom = gradient(['#39FF14', '#00FFD5', '#00B3FF', '#7A00FF', '#FF00D0']);
        const colored = neom.multiline(fig);
        try { return require('chalk').bold(colored); } catch (e) { return colored; }
    } catch (e) {
        return fig;
    }
}

function httpJsonRequest(method, pathUrl, payload) {
    return new Promise((resolve, reject) => {
        const data = payload ? JSON.stringify(payload) : null;
        const opts = {
            hostname: CONTROL_HOST,
            port: CONTROL_PORT,
            path: pathUrl,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data ? Buffer.byteLength(data) : 0
            },
            timeout: 2000
        };
        const req = http.request(opts, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    const parsed = body ? JSON.parse(body) : {};
                    resolve(parsed);
                } catch (e) {
                    resolve({ raw: body });
                }
            });
        });
        req.on('error', (err) => reject(err));
        if (data) req.write(data);
        req.end();
    });
}

async function controlIsReady() {
    try {
        const resp = await httpJsonRequest('GET', '/control/status');
        return !!resp && typeof resp === 'object';
    } catch (e) {
        return false;
    }
}

async function ensureControlServerStarted() {
    if (await controlIsReady()) return true;

    console.log('Control API not found. Attempting to start server.py --daemon...');
    // Spawn python server.py --daemon in repo root
    const cwd = process.cwd();
    const python = process.env.PYTHON || 'python';
    try {
        const child = spawn(python, ['server.py', '--daemon'], {
            cwd,
            detached: true,
            stdio: 'ignore'
        });
        child.unref();
    } catch (e) {
        console.error('Failed to spawn python server:', e.message || e);
        return false;
    }

    // Poll for control API up to 10 seconds
    const start = Date.now();
    while (Date.now() - start < 10000) {
        if (await controlIsReady()) return true;
        await new Promise(r => setTimeout(r, 500));
    }
    console.error('Control API did not become available (timed out).');
    return false;
}

async function callControlAction(action, extra) {
    const payload = Object.assign({ action }, extra || {});
    return httpJsonRequest('POST', '/control', payload);
}

async function listModels() {
    try {
        const res = await callControlAction('list_models');
        return res.models || [];
    } catch (e) {
        console.error('Failed to list models:', e.message || e);
        return [];
    }
}

async function promptSelectModel() {
    const models = await listModels();
    if (!models.length) {
        console.log('\nNo models found (is Ollama running?).');
        return;
    }
    const prompt = new Select({
        name: 'model',
        message: 'Select AI model',
        choices: models
    });
    try {
        const choice = await prompt.run();
        await callControlAction('select_model', { model: choice });
        console.log(`\nSelected model: ${choice}`);
    } catch (e) {
        console.error('Model selection cancelled or failed.');
    }
}

async function promptUnloadModel() {
    const models = await listModels();
    const choices = models.slice();
    choices.unshift('(current)');
    const prompt = new Select({
        name: 'unload',
        message: 'Select model to unload (or choose current) ',
        choices
    });
    try {
        const choice = await prompt.run();
        if (choice === '(current)') {
            await callControlAction('unload_model');
        } else {
            await callControlAction('unload_model', { model: choice });
        }
        console.log('\nUnload requested.');
    } catch (e) {
        console.error('Unload cancelled or failed.');
    }
}

async function listLocalNotes() {
    const file = path.join(process.cwd(), 'notes-export.json');
    try {
        if (!fs.existsSync(file)) return [];
        const data = fs.readFileSync(file, 'utf8');
        const notes = JSON.parse(data);
        return notes;
    } catch (e) {
        console.error('Failed to read notes:', e.message || e);
        return [];
    }
}

function renderMarkdownToTerminal(md) {
    // Use marked to parse into tokens and render basic formatting with chalk
    const renderer = new marked.Renderer();

    renderer.heading = (text, level) => {
        const bold = chalk.bold.hex('#ffffff');
        // More saturated accent for headings (vivid blue)
        const accent = chalk.hex('#1E90FF').bold;
        const size = {1: chalk.bgHex('#1E90FF').hex('#ffffff').bold, 2: accent, 3: accent, 4: chalk.hex('#63b3ff').bold}[level] || accent;
        return '\n' + size(text) + '\n';
    };

    renderer.paragraph = (text) => {
        // Slightly increase saturation for inline links and bold text
        return chalk.hex('#f3f4f6')(text) + '\n';
    };

    renderer.code = (code, infostring, escaped) => {
        return '\n' + chalk.bgHex('#0b1220').hex('#a7f3d0')('\n' + code + '\n') + '\n';
    };

    renderer.blockquote = (quote) => {
        return chalk.hex('#93c5fd').italic('\n> ' + quote + '\n');
    };

    renderer.listitem = (text) => {
        return '  ' + chalk.hex('#f8fafc')('- ') + chalk.hex('#dbeafe')(text) + '\n';
    };

    // Inline rendering tweaks
    const inlineRenderer = renderer;
    const origStrong = inlineRenderer.strong || ((t) => `**${t}**`);
    inlineRenderer.strong = (text) => chalk.hex('#ffffff').bold(text);
    inlineRenderer.em = (text) => chalk.hex('#bfdbfe').italic(text);
    inlineRenderer.codespan = (text) => chalk.bgHex('#0b1220').hex('#bae6fd')(text);
    inlineRenderer.link = (href, title, text) => chalk.hex('#60a5fa').underline(text + ` (${href})`);

    marked.setOptions({ renderer: inlineRenderer });
    try {
        return marked.parse(md);
    } catch (e) {
        return md;
    }
}

async function viewNotesFlow() {
    const notes = await listLocalNotes();
    if (!notes.length) {
        console.log('\nNo local notes found (notes-export.json missing or empty).');
        return;
    }

    const choices = notes.map(n => ({ name: n.id, message: (n.title || '(untitled)') }));
    const prompt = new Select({
        name: 'note',
        message: 'Select a note to view',
        choices: choices.map(c => c.message)
    });

    try {
        const choice = await prompt.run();
        const note = notes.find(n => (n.title || '(untitled)') === choice);
        if (!note) return;

        console.clear();
        console.log(renderHeader(note.title || 'Untitled'));
        console.log('\n' + renderMarkdownToTerminal(note.body || ''));
        console.log('\n---\n');
        console.log(chalk.hex('#9ca3af')('Press any key to return...'));
        await waitForKeypress();
    } catch (e) {
        console.error('Note viewing cancelled or failed.');
    }
}

async function showMenu() {
    console.clear();
    console.log(renderHeader('MD-NOTES'));
    console.log('\n  Welcome to MD-Notes — quick selector\n');

    const choices = [
        { name: 'start', message: 'Start Server' },
        { name: 'stop', message: 'Stop Server' },
        { name: 'restart', message: 'Restart Server' },
        { name: 'logs', message: 'Live Logs (New Window)' },
        { name: 'browser', message: 'Open in Browser' },
        { name: 'clear', message: 'Clear Screen' },
        { name: 'select_model', message: 'Select AI Model' },
        { name: 'unload', message: 'Unload Model from VRAM' },
        { name: 'export', message: 'Export Notes' },
        { name: 'view_notes', message: 'View Notes' },
        { name: 'quit', message: 'Quit' }
    ];

    const prompt = new Select({
        name: 'actions',
        message: 'Choose an action (use ↑/↓ or j/k, Enter to select)',
        choices: choices.map(c => c.message),
        pointer: '❯',
        indicator: '•'
    });

    try {
        const answer = await prompt.run();
        const selected = choices.find(c => c.message === answer);
        await handleChoice(selected ? selected.name : null);
    } catch (err) {
        // User cancelled (Esc) or prompt failed
        if (err === '') {
            process.exit(0);
        }
        console.error('Prompt failed:', err);
        process.exit(1);
    }
}

async function handleChoice(choice) {
    switch (choice) {
        case 'start':
            await callControlAction('start');
            console.log('\nStart requested.');
            break;
        case 'stop':
            await callControlAction('stop');
            console.log('\nStop requested.');
            break;
        case 'restart':
            await callControlAction('restart');
            console.log('\nRestart requested.');
            break;
        case 'logs':
            await callControlAction('open_logs');
            break;
        case 'browser':
            await callControlAction('open_browser');
            break;
        case 'clear':
            console.clear();
            break;
        case 'select_model':
            await promptSelectModel();
            break;
        case 'unload':
            await promptUnloadModel();
            break;
        case 'export':
            console.log('\nExporting notes to notes-export.json (dry run).');
            break;
        case 'view_notes':
            await viewNotesFlow();
            break;
        case 'quit':
        default:
            console.log('\nGoodbye.');
            process.exit(0);
    }

    console.log('\nPress any key to return to menu...');
    await waitForKeypress();
    await showMenu();
}

function waitForKeypress() {
    return new Promise((resolve) => {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.once('data', () => {
            process.stdin.setRawMode(false);
            process.stdin.pause();
            resolve();
        });
    });
}

async function main() {
    try {
        const ok = await ensureControlServerStarted();
        if (!ok) {
            console.error('Unable to start or contact control API. Exiting.');
            process.exit(1);
        }
        await showMenu();
    } catch (err) {
        console.error('CLI error:', err);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
