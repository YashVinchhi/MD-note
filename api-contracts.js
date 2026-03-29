(function (global) {
    const API_SCHEMA_VERSION = 'v1';

    function createContractError(message) {
        const err = new Error(message);
        err.name = 'ApiContractError';
        return err;
    }

    function ensureObject(value, context) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw createContractError(`Invalid ${context}: expected object`);
        }
    }

    function ensureNonEmptyString(value, field) {
        if (typeof value !== 'string' || !value.trim()) {
            throw createContractError(`Invalid field: ${field}`);
        }
    }

    function validateRequest(path, payload) {
        ensureObject(payload, 'request payload');

        if (path === '/api/generate') {
            ensureNonEmptyString(payload.prompt, 'prompt');
            if (Object.prototype.hasOwnProperty.call(payload, 'stream') && typeof payload.stream !== 'boolean') {
                throw createContractError('Invalid field: stream must be boolean');
            }
            return payload;
        }

        if (path === '/api/chat') {
            if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
                throw createContractError('Invalid field: messages must be a non-empty array');
            }
            return payload;
        }

        if (path === '/api/embeddings') {
            const prompt = payload.prompt || payload.input;
            ensureNonEmptyString(prompt, 'prompt');
            return payload;
        }

        if (path === '/api/model') {
            ensureNonEmptyString(payload.model, 'model');
            return payload;
        }

        if (path === '/api/file-notes/sync') {
            if (!Array.isArray(payload.notes)) {
                throw createContractError('Invalid field: notes must be an array');
            }
            return payload;
        }

        return payload;
    }

    function validateResponse(path, payload) {
        ensureObject(payload, 'response payload');

        if (payload.error && typeof payload.error !== 'string') {
            throw createContractError('Invalid response: error must be a string');
        }

        if (path === '/api/default-model') {
            ensureNonEmptyString(payload.model, 'model');
            if (payload.schemaVersion && payload.schemaVersion !== API_SCHEMA_VERSION) {
                throw createContractError(`Unsupported schemaVersion: ${payload.schemaVersion}`);
            }
            return payload;
        }

        if (path === '/api/model') {
            if (typeof payload.ok !== 'boolean') {
                throw createContractError('Invalid response: ok must be boolean');
            }
            ensureNonEmptyString(payload.model, 'model');
            return payload;
        }

        if (path === '/api/chat') {
            if (!payload.message && !payload.response && !payload.error) {
                throw createContractError('Invalid response: missing chat content');
            }
            return payload;
        }

        if (path === '/api/generate') {
            if (!Object.prototype.hasOwnProperty.call(payload, 'response') && !payload.error) {
                throw createContractError('Invalid response: missing response field');
            }
            return payload;
        }

        if (path === '/api/embeddings') {
            if (!Array.isArray(payload.embedding) && !payload.error) {
                throw createContractError('Invalid response: embedding must be an array');
            }
            return payload;
        }

        return payload;
    }

    const api = {
        API_SCHEMA_VERSION,
        validateRequest,
        validateResponse,
        createContractError
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    global.ApiContracts = api;
})(typeof window !== 'undefined' ? window : globalThis);
