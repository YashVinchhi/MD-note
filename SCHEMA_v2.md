# Database Schema v2

## Stores
### notes
- `id` (PK)
- `title`
- `*tags` (Multi-index)
- `date`
- `pinned`
- `updatedAt`
- `summary`
- `folderId` (Index) [NEW]

### folders [NEW]
- `id` (PK)
- `parentId` (Index) - for nesting
- `name`
- `collapsed` (Boolean) - UI state

### smart_views [NEW]
- `id` (PK)
- `name`
- `query` (String) - e.g., "tag:todo date:today"
- `icon` (String)

## Migration Notes
- Automatically handled by Dexie.
- New fields allow `undefined` for existing records.
