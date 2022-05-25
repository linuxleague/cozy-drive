import { combineReducers } from 'redux'

import logger from 'lib/logger'
import { CozyFile } from 'models'

import { logException } from 'drive/lib/reporter'
import UploadQueue from './UploadQueue'
import {
  encryptAndUploadNewFile,
  getEncryptionKeyFromDirId
} from 'drive/lib/encryption'
import { DOCTYPE_FILES } from 'drive/lib/doctypes'
import flag from 'cozy-flags'

import { models } from 'cozy-client'
const { doMobileUpload, readMobileFile, uploadFileWithConflictStrategy } =
  models.file

export { UploadQueue }

const SLUG = 'upload'

export const ADD_TO_UPLOAD_QUEUE = 'ADD_TO_UPLOAD_QUEUE'
const UPLOAD_FILE = 'UPLOAD_FILE'
const UPLOAD_PROGRESS = 'UPLOAD_PROGRESS'
const RECEIVE_UPLOAD_SUCCESS = 'RECEIVE_UPLOAD_SUCCESS'
const RECEIVE_UPLOAD_ERROR = 'RECEIVE_UPLOAD_ERROR'
const PURGE_UPLOAD_QUEUE = 'PURGE_UPLOAD_QUEUE'

const CANCEL = 'cancel'
const PENDING = 'pending'
const LOADING = 'loading'
const CREATED = 'created'
const UPDATED = 'updated'
const FAILED = 'failed'
const CONFLICT = 'conflict'
const QUOTA = 'quota'
const NETWORK = 'network'
const DONE_STATUSES = [CREATED, UPDATED]
const ERROR_STATUSES = [CONFLICT, NETWORK, QUOTA]

export const status = {
  CANCEL,
  PENDING,
  LOADING,
  CREATED,
  UPDATED,
  FAILED,
  CONFLICT,
  QUOTA,
  NETWORK,
  DONE_STATUSES,
  ERROR_STATUSES
}

const CONFLICT_ERROR = 409

const itemInitialState = item => ({
  ...item,
  status: PENDING,
  progress: null
})

const getStatus = (state, action) => {
  switch (action.type) {
    case UPLOAD_FILE:
      return LOADING
    case RECEIVE_UPLOAD_SUCCESS:
      return action.isUpdate ? UPDATED : CREATED
    case RECEIVE_UPLOAD_ERROR:
      return action.status
    default:
      return state
  }
}

const getSpeed = (state, action) => {
  const lastLoaded = state.loaded
  const lastUpdated = state.lastUpdated
  const now = action.date
  const nowLoaded = action.loaded
  return ((nowLoaded - lastLoaded) / (now - lastUpdated)) * 1000
}

let remainingTimes = []
let averageRemainingTime = undefined
let timeout = undefined

const getProgress = (state, action) => {
  if (action.type == RECEIVE_UPLOAD_SUCCESS) {
    return null
  } else if (action.type === UPLOAD_PROGRESS) {
    const speed = state ? getSpeed(state, action) : null
    const loaded = action.loaded
    const total = action.total
    const instantRemainingTime =
      speed && total && loaded ? (total - loaded) / speed : null

    if (!averageRemainingTime) {
      averageRemainingTime = instantRemainingTime
    }

    if (instantRemainingTime) {
      remainingTimes.push(instantRemainingTime)
    }

    if (!timeout) {
      timeout = setTimeout(() => {
        averageRemainingTime =
          remainingTimes.reduce((a, b) => a + b) / remainingTimes.length

        clearTimeout(timeout)
        timeout = undefined
        remainingTimes = []
      }, 3000)
    }

    return {
      loaded,
      total,
      lastUpdated: action.date,
      speed,
      remainingTime: averageRemainingTime
    }
  } else if (action.type === RECEIVE_UPLOAD_ERROR) {
    return null
  } else {
    return state
  }
}

const item = (state, action = { isUpdate: false }) => ({
  ...state,
  status: getStatus(state.status, action),
  progress: getProgress(state.progress, action)
})

export const queue = (state = [], action) => {
  switch (action.type) {
    case ADD_TO_UPLOAD_QUEUE:
      return [
        ...state.filter(i => i.status !== CREATED),
        ...action.files.map(f => itemInitialState(f))
      ]
    case PURGE_UPLOAD_QUEUE:
      return []
    case UPLOAD_FILE:
    case RECEIVE_UPLOAD_SUCCESS:
    case RECEIVE_UPLOAD_ERROR:
    case UPLOAD_PROGRESS:
      return state.map(i =>
        i.file.name !== action.file.name ? i : item(i, action)
      )
    default:
      return state
  }
}

export default combineReducers({ queue })

export const uploadProgress = (file, event, date) => ({
  type: UPLOAD_PROGRESS,
  file,
  loaded: event.loaded,
  total: event.total,
  date: date || Date.now()
})

export const processNextFile =
  (
    fileUploadedCallback,
    queueCompletedCallback,
    dirID,
    sharingState,
    { client, vaultClient }
  ) =>
  async (dispatch, getState) => {
    let error = null
    if (!client) {
      throw new Error(
        'Upload module needs a cozy-client instance to work. This instance should be made available by using the extraArgument function of redux-thunk'
      )
    }
    const item = getUploadQueue(getState()).find(i => i.status === PENDING)
    if (!item) {
      return dispatch(onQueueEmpty(queueCompletedCallback))
    }

    const { file, entry, isDirectory } = item
    const encryptionKey = flag('drive.enable-encryption')
      ? await getEncryptionKeyFromDirId(client, dirID)
      : null
    try {
      dispatch({ type: UPLOAD_FILE, file })
      if (entry && isDirectory) {
        const newDir = await uploadDirectory(client, entry, dirID, {
          vaultClient,
          encryptionKey
        })
        fileUploadedCallback(newDir)
      } else {
        const withProgress = {
          onUploadProgress: event => {
            dispatch(uploadProgress(file, event))
          }
        }

        const uploadedFile = await uploadFile(client, file, dirID, {
          vaultClient,
          encryptionKey,
          ...withProgress
        })

        fileUploadedCallback(uploadedFile)
      }
      dispatch({ type: RECEIVE_UPLOAD_SUCCESS, file })
    } catch (uploadError) {
      error = uploadError
      if (uploadError.status === CONFLICT_ERROR) {
        try {
          const path = await CozyFile.getFullpath(dirID, file.name)
          const uploadedFile = await overwriteFile(client, file, path, {
            onUploadProgress: event => {
              dispatch(uploadProgress(file, event))
            }
          })
          fileUploadedCallback(uploadedFile)
          dispatch({ type: RECEIVE_UPLOAD_SUCCESS, file, isUpdate: true })
          error = null
        } catch (updateError) {
          error = updateError
        }
      }
      if (error) {
        logger.warn(error)
        logException(
          `Upload module catches an error when executing processNextFile(): ${error}`
        )
        const statusError = {
          409: CONFLICT,
          413: QUOTA
        }

        const status =
          statusError[error.status] ||
          (/Failed to fetch$/.exec(error.toString()) && NETWORK) ||
          FAILED

        dispatch({ type: RECEIVE_UPLOAD_ERROR, file, status })
      }
    }
    dispatch(
      processNextFile(
        fileUploadedCallback,
        queueCompletedCallback,
        dirID,
        sharingState,
        { client, vaultClient }
      )
    )
  }

const getFileFromEntry = entry => new Promise(resolve => entry.file(resolve))

const uploadDirectory = async (
  client,
  directory,
  dirID,
  { vaultClient, encryptionKey }
) => {
  const newDir = await createFolder(client, directory.name, dirID)
  const dirReader = directory.createReader()
  return new Promise(resolve => {
    const entriesReader = async entries => {
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i]
        if (entry.isFile) {
          const file = await getFileFromEntry(entry)
          await uploadFile(client, file, newDir.id, {
            vaultClient,
            encryptionKey
          })
        } else if (entry.isDirectory) {
          await uploadDirectory(client, entry, newDir.id, {
            vaultClient,
            encryptionKey
          })
        }
      }
      resolve(newDir)
    }
    dirReader.readEntries(entriesReader)
  })
}

const createFolder = async (client, name, dirID) => {
  const resp = await client
    .collection(DOCTYPE_FILES)
    .createDirectory({ name, dirId: dirID })
  return resp.data
}

const uploadFile = async (client, file, dirID, options = {}) => {
  /** We have a bug with Chrome returning SPDY_ERROR_PROTOCOL.
   * This is certainly caused by the couple HTTP2 / HAProxy / CozyStack
   * when something cut the HTTP connexion before the Stack
   *
   * We can not intercept this error since Chrome only returns
   * `Failed to fetch` as if we were offline. The only workaround for
   * now, is to check if we'll have enough size on the Cozy before
   * trying to upload the file to detect if we'll go out of quota
   * before connexion being cut by something.
   *
   * We don't need to do that work on other browser (window.chrome
   * should be available on new Edge, Chrome, Chromium, Brave, Opera...)
   */
  if (window.chrome) {
    const { data: diskUsage } = await client
      .getStackClient()
      .fetchJSON('GET', '/settings/disk-usage')
    if (diskUsage.attributes.quota) {
      if (
        parseInt(diskUsage.attributes.used) + parseInt(file.size) >
        parseInt(diskUsage.attributes.quota)
      ) {
        const error = new Error('Payload Too Large')
        error.status = 413
        throw error
      }
    }
  }

  const { onUploadProgress, encryptionKey, vaultClient } = options

  if (encryptionKey && vaultClient) {
    // TODO: use web worker
    const fr = new FileReader()
    fr.onloadend = async () => {
      return encryptAndUploadNewFile(client, vaultClient, {
        binary: fr.result,
        encryptionKey,
        fileOptions: {
          name: file.name,
          dirID,
          onUploadProgress
        }
      })
    }
    fr.readAsArrayBuffer(file)
  } else {
    const resp = await client
      .collection(DOCTYPE_FILES)
      .createFile(file, { dirId: dirID, onUploadProgress })

    return resp.data
  }
}

/*
 * @function
 * @param {Object} client - A CozyClient instance
 * @param {Object} file - The uploaded javascript File object
 * @param {string} path - The file's path in the cozy
 * @param {{onUploadProgress}} options
 * @return {Object} - The updated io.cozy.files
 */
export const overwriteFile = async (client, file, path, options = {}) => {
  const statResp = await client.collection(DOCTYPE_FILES).statByPath(path)
  const { id: fileId, dir_id: dirId } = statResp.data
  const resp = await client
    .collection(DOCTYPE_FILES)
    .updateFile(file, { dirId, fileId, options })

  return resp.data
}

export const uploadFilesFromNative =
  (files, folderId, uploadFilesSuccessCallback, { client, vaultClient }) =>
  async dispatch => {
    dispatch({
      type: ADD_TO_UPLOAD_QUEUE,
      files: files
    })
    const encryptionKey = await getEncryptionKeyFromDirId(client, folderId)
    // !TODO Promise.All to use parallelization
    for (const file of files) {
      try {
        const fileOpts = {
          name: file.file.name,
          dirId: folderId,
          conflictStrategy: 'rename'
        }
        if (encryptionKey) {
          const blobFile = await readMobileFile(file.file.fileUrl)
          const encryptedFile = await vaultClient.encryptFile(
            blobFile,
            encryptionKey
          )
          await uploadFileWithConflictStrategy(client, encryptedFile, {
            ...fileOpts,
            contentType: file.file.type
          })
        } else {
          await doMobileUpload(client, file.file.fileUrl, {
            ...fileOpts,
            contentType: file.file.type
          })
        }
        dispatch(removeFileToUploadQueue(file.file))
      } catch (error) {
        logger.error(
          `Uploading files from native failed with file ${file.file}: ${error}`
        )
      }
    }

    if (uploadFilesSuccessCallback) uploadFilesSuccessCallback()
  }

export const removeFileToUploadQueue = file => async dispatch => {
  dispatch({ type: RECEIVE_UPLOAD_SUCCESS, file, isUpdate: true })
}

export const addToUploadQueue =
  (
    files,
    dirID,
    sharingState,
    fileUploadedCallback,
    queueCompletedCallback,
    { client, vaultClient }
  ) =>
  async dispatch => {
    dispatch({
      type: ADD_TO_UPLOAD_QUEUE,
      files: extractFilesEntries(files)
    })
    dispatch(
      processNextFile(
        fileUploadedCallback,
        queueCompletedCallback,
        dirID,
        sharingState,
        { client, vaultClient }
      )
    )
  }

export const purgeUploadQueue = () => ({ type: PURGE_UPLOAD_QUEUE })

export const onQueueEmpty = callback => (dispatch, getState) => {
  const queue = getUploadQueue(getState())
  const quotas = getQuotaErrors(queue)
  const conflicts = getConflicts(queue)
  const created = getCreated(queue)
  const updated = getUpdated(queue)
  const networkErrors = getNetworkErrors(queue)
  const errors = getErrors(queue)

  return callback(created, quotas, conflicts, networkErrors, errors, updated)
}

// selectors
const filterByStatus = (queue, status) => queue.filter(f => f.status === status)
const getConflicts = queue => filterByStatus(queue, CONFLICT)
const getErrors = queue => filterByStatus(queue, FAILED)
const getQuotaErrors = queue => filterByStatus(queue, QUOTA)
const getNetworkErrors = queue => filterByStatus(queue, NETWORK)
const getCreated = queue => filterByStatus(queue, CREATED)
const getUpdated = queue => filterByStatus(queue, UPDATED)

export const getUploadQueue = state => state[SLUG].queue

export const getProcessed = state =>
  getUploadQueue(state).filter(f => f.status !== PENDING)

export const getSuccessful = state => {
  const queue = getUploadQueue(state)
  return queue.filter(f => [CREATED, UPDATED].includes(f.status))
}

export const selectors = {
  getConflicts,
  getErrors,
  getQuotaErrors,
  getNetworkErrors,
  getCreated,
  getUpdated,
  getProcessed,
  getSuccessful
}

// DOM helpers
const extractFilesEntries = items => {
  let results = []
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]
    if (item.webkitGetAsEntry != null && item.webkitGetAsEntry()) {
      const entry = item.webkitGetAsEntry()
      results.push({
        file: item.getAsFile(),
        isDirectory: entry.isDirectory === true,
        entry
      })
    } else {
      results.push({ file: item, isDirectory: false, entry: null })
    }
  }

  if (results.length === 0) {
    logger.warn('Upload module files entries extraction: no file entry')
  }

  return results
}
