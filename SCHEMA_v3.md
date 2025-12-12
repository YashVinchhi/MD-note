# Database Schema v3

## Stores
### notes
- `id` (PK)
- `title`
- `*tags` (Multi-index)
- `date`
- `pinned`
- `updatedAt`
- `summary`
- `folderId` (Index)

### folders
- `id` (PK)
- `parentId` (Index)
- `name`
- `collapsed` (Boolean)

### smart_views
- `id` (PK)
- `name`
- `query` (String)
- `icon` (String)

### attachments [NEW]
- `id` (PK) - UUID
- `noteId` (Index)
- `type` (String) - MIME type
- `createdAt` (Number)
- `blob` (Blob/Binary) - Not indexed

## Migration Notes
- Automatically handled by Dexie.
