const fs = require('fs');
const path = require('path');
const marked = require('marked');
const chalk = require('chalk');

function renderMarkdownToTerminal(md) {
    const renderer = new marked.Renderer();
    renderer.heading = (text, level) => {
        const accent = chalk.hex('#1E90FF').bold;
        const size = {1: chalk.bgHex('#1E90FF').hex('#ffffff').bold, 2: accent, 3: accent}[level] || accent;
        return '\n' + size(text) + '\n';
    };
    renderer.paragraph = (text) => chalk.hex('#f3f4f6')(text) + '\n';
    renderer.code = (code, infostring, escaped) => '\n' + chalk.bgHex('#0b1220').hex('#a7f3d0')('\n' + code + '\n') + '\n';
    renderer.blockquote = (quote) => chalk.hex('#93c5fd').italic('\n> ' + quote + '\n');
    renderer.listitem = (text) => '  ' + chalk.hex('#f8fafc')('- ') + chalk.hex('#dbeafe')(text) + '\n';
    renderer.strong = (text) => chalk.hex('#ffffff').bold(text);
    renderer.em = (text) => chalk.hex('#bfdbfe').italic(text);
    renderer.codespan = (text) => chalk.bgHex('#0b1220').hex('#bae6fd')(text);
    renderer.link = (href, title, text) => chalk.hex('#60a5fa').underline(text + ` (${href})`);
    marked.setOptions({ renderer });
    return marked.parse(md);
}

const file = path.join(process.cwd(), 'notes-export.json');
if (!fs.existsSync(file)) {
    console.error('notes-export.json not found');
    process.exit(1);
}
const notes = JSON.parse(fs.readFileSync(file,'utf8'));
const note = notes[0];
console.log(chalk.bold.yellow('\n--- Rendering first note (test_render_note.js) ---\n'));
console.log(chalk.bold.blue(note.title || 'Untitled'));
console.log(renderMarkdownToTerminal(note.body || ''));
console.log(chalk.bold.yellow('\n--- End ---\n'));

