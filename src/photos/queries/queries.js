import { Q, fetchPolicies } from 'cozy-client'

import { DOCTYPE_ALBUMS } from 'drive/lib/doctypes'

const older30s = 30 * 1000

// Export to doctypes
const FILES_DOCTYPE = 'io.cozy.files'

export const buildTimelineQuery = () => ({
  definition: Q(FILES_DOCTYPE)
    .where({
      class: 'image',
      'metadata.datetime': {
        $gt: null
      }
    })
    .partialIndex({
      trashed: false
    })
    .indexFields(['class', 'metadata.datetime'])
    .select([
      'dir_id',
      'name',
      'size',
      'updated_at',
      'metadata',
      'metadata.datetime',
      'trashed',
      'class'
    ])
    .sortBy([
      {
        class: 'desc'
      },
      {
        'metadata.datetime': 'desc'
      }
    ])
    .include(['albums']),
  options: {
    as: 'timeline',
    fetchPolicy: fetchPolicies.olderThan(older30s)
  }
})

// Albums doctype -------------

export const buildAlbumsQuery = albumId => ({
  definition: Q(DOCTYPE_ALBUMS).getById(albumId).include(['photos']),
  options: {
    as: `albums-${albumId}`,
    singleDocData: true,
    fetchPolicy: fetchPolicies.olderThan(older30s)
  }
})
