import { CloudSong } from "@signal-app/api"
import { basename } from "../helpers/path"
import { useAutoSave } from "../hooks/useAutoSave"
import { songFromMidi, songToMidi } from "../midi/midiConversion"
import {
  cloudMidiRepository,
  cloudSongDataRepository,
  cloudSongRepository,
  userRepository,
} from "../services/repositories"
import Song from "../song"

export const useLoadSong = () => {
  return async (cloudSong: CloudSong) => {
    const songData = await cloudSongDataRepository.get(cloudSong.songDataId)
    const song = songFromMidi(songData)
    song.name = cloudSong.name
    song.cloudSongId = cloudSong.id
    song.cloudSongDataId = cloudSong.songDataId
    song.isSaved = true
    return song
  }
}

export const useCreateSong = () => {
  const { onUserExplicitAction } = useAutoSave()

  return async (song: Song) => {
    const bytes = songToMidi(song)
    const songDataId = await cloudSongDataRepository.create({ data: bytes })
    const songId = await cloudSongRepository.create({
      name: song.name,
      songDataId: songDataId,
    })

    song.cloudSongDataId = songDataId
    song.cloudSongId = songId
    song.isSaved = true
    onUserExplicitAction()
  }
}

export const useUpdateSong = () => {
  const { onUserExplicitAction } = useAutoSave()

  return async (song: Song) => {
    if (song.cloudSongId === null || song.cloudSongDataId === null) {
      throw new Error("This song is not loaded from the cloud")
    }

    const bytes = songToMidi(song)

    await cloudSongRepository.update(song.cloudSongId, {
      name: song.name,
    })

    await cloudSongDataRepository.update(song.cloudSongDataId, {
      data: bytes,
    })

    song.isSaved = true
    onUserExplicitAction()
  }
}

export const useDeleteSong = () => {
  return async (song: CloudSong) => {
    await cloudSongDataRepository.delete(song.songDataId)
    await cloudSongRepository.delete(song.id)
  }
}

export const useLoadSongFromExternalMidiFile = () => {
  return async (midiFileUrl: string) => {
    const id = await cloudMidiRepository.storeMidiFile(midiFileUrl)
    const data = await cloudMidiRepository.get(id)
    const song = songFromMidi(data)
    song.name = basename(midiFileUrl) ?? ""
    song.isSaved = true
    return song
  }
}

// New function that loads MIDI files directly without Firebase
export const useLoadSongFromDirectMidiUrl = () => {
  return async (midiFileUrl: string) => {
    try {
      // Fetch the MIDI file directly from the URL
      const response = await fetch(midiFileUrl)
      
      if (!response.ok) {
        throw new Error(`Failed to fetch MIDI file: ${response.status} ${response.statusText}`)
      }
      
      // Convert response to ArrayBuffer
      const arrayBuffer = await response.arrayBuffer()
      
      // Convert to song using the existing songFromMidi function
      const song = songFromMidi(arrayBuffer)
      song.name = basename(midiFileUrl) ?? ""
      song.isSaved = false // Mark as not saved since it's loaded from external URL
      
      return song
    } catch (error) {
      throw new Error(`Failed to load MIDI file from URL: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
}

export const usePublishSong = () => {
  return async (song: Song) => {
    const user = await userRepository.getCurrentUser()
    if (user === null) {
      throw new Error("Failed to get current user, please re-sign in")
    }
    if (song.cloudSongId === null || song.cloudSongDataId === null) {
      throw new Error("This song is not saved in the cloud")
    }
    await cloudSongDataRepository.publish(song.cloudSongDataId)
    await cloudSongRepository.publish(song.cloudSongId, user)
  }
}

export const useUnpublishSong = () => {
  return async (song: Song) => {
    if (song.cloudSongId === null || song.cloudSongDataId === null) {
      throw new Error("This song is not loaded from the cloud")
    }
    await cloudSongDataRepository.unpublish(song.cloudSongDataId)
    await cloudSongRepository.unpublish(song.cloudSongId)
  }
}
