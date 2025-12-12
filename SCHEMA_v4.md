# Database Schema v4

## Stores
### notes
- `id` (PK)
- `title`
- `*tags`
- `date`
- `pinned`
- `updatedAt`
- `summary`
- `folderId`

### folders
- `id` (PK)
- `parentId`
- `name`
- `collapsed`

### smart_views
- `id` (PK)
- `name`
- `query`
- `icon`

### attachments
- `id` (PK)
- `noteId`
- `blob`

### embeddings [NEW]
- `noteId` (PK)
- `updatedAt` (Number) - Timestamp of when embedding was generated
- `vector` (Array<Number>) - The embedding vector (not indexed)

## Migration Notes
- Automatically handled by Dexie.
