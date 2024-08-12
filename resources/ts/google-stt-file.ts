import fs from 'fs'

// Imports the Google Cloud client library
import speech from '@google-cloud/speech'

// Creates a client
const client = new speech.SpeechClient()

/**
 * TODO(developer): Uncomment the following lines before running the sample.
 */
const filename = '/Users/umutozdogan/Developer/github/hubblr/adonis/voice.mp3'
// const encoding = 'mp3'
// const sampleRateHertz = 16000
// const languageCode = 'BCP-47 language code, e.g. en-US'

// Stream the audio to the Google Cloud Speech API
const recognizeStream = client
  .streamingRecognize({
    config: {
      encoding: 'MP3',
      sampleRateHertz: 48000,
      languageCode: 'en',
    },
    interimResults: false,
  })
  .on('error', console.error)
  .on('data', (data) => {
    console.log(`Transcription: ${data.results[0].alternatives[0].transcript}`)
    // console.log(data)
  })

// Stream an audio file from disk to the Speech API, e.g. "./resources/audio.raw"
fs.createReadStream(filename).pipe(recognizeStream)
