const express = require('express');
const WebSocket = require('ws');
const speech = require('@google-cloud/speech');
const translate = require('@google-cloud/translate');
const path = require('path'); // Import the path module

// Check for GOOGLE_CLOUD_PROJECT environment variable
if (!process.env.GOOGLE_CLOUD_PROJECT) {
  console.error('FATAL ERROR: GOOGLE_CLOUD_PROJECT environment variable not set.');
  console.error('Translation and potentially other Google Cloud services will fail.');
  console.error('Please set this variable before running the server.');
  process.exit(1); // Exit if critical environment variable is missing
}

const app = express();

// --- START OF FIX ---
// Serve index.html from the current directory
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
// --- END OF FIX ---

// Alternatively, if you want to serve all static files from a 'public' directory:
// app.use(express.static('public')); // Then make sure index.html is in a folder named 'public'

const server = app.listen(8080, () => {
  console.log('Server running on port 8080');
  console.log('Open http://localhost:8080 in your browser.'); // Added for clarity
});
const wss = new WebSocket.Server({ server });

const speechClient = new speech.SpeechClient();
const translateClient = new translate.TranslationServiceClient();


wss.on('connection', (ws) => {
  console.log('WebSocket client connected');

  let recognizeStream = null;
  let audioQueue = [];
  // streamReady is implicitly true when recognizeStream is not null and writable.

  const initializeStream = () => {
    // This is the StreamingRecognitionConfig object
    const requestConfig = {
      config: {
        encoding: 'WEBM_OPUS', // Matches client MediaRecorder mimeType
        sampleRateHertz: 48000, // Common for Opus; Speech API recommends specifying for WEBM_OPUS
        languageCode: 'en-US',
        enableAutomaticPunctuation: true, // Example: good for transcriptions
      },
      interimResults: true,
    };

    console.log('Initializing new Recognize stream...');
    recognizeStream = speechClient
      .streamingRecognize(requestConfig) // CORRECTED: Pass requestConfig directly
      .on('error', (error) => {
        console.error('Speech-to-Text API Error:', error);
        if (recognizeStream) {
            recognizeStream.destroy(); // Clean up the errored stream
        }
        recognizeStream = null;
        // Optionally, notify the client about the error
        // ws.send(JSON.stringify({ error: 'Speech recognition error. Please try again.' }));
      })
      .on('data', async (data) => {
        const transcription = data.results[0]?.alternatives[0]?.transcript || '';
        // console.log('Transcription:', transcription); // Log only final for less noise, or specific interim handling

        if (data.results[0] && data.results[0].isFinal) {
            console.log('Final Transcription:', transcription);
            let translation = '';
            if (transcription) {
              try {
                const [response] = await translateClient.translateText({
                  contents: [transcription],
                  mimeType: 'text/plain', // Mime types: text/plain, text/html
                  sourceLanguageCode: 'en',
                  targetLanguageCode: 'hi',
                  parent: `projects/${process.env.GOOGLE_CLOUD_PROJECT}/locations/global`,
                });
                translation = response.translations[0].translatedText;
                console.log('Translation:', translation);
              } catch (err) {
                console.error('Translation API error:', err);
              }
            }
            // Send final transcription and its translation
            ws.send(JSON.stringify({ transcription, translation, isFinal: true }));
        } else if (transcription) {
            // Send interim transcription
            ws.send(JSON.stringify({ transcription, translation: 'Translating...', isFinal: false }));
        }
      })
      .on('end', () => {
        console.log('Recognize stream ended.');
        // recognizeStream = null; // It will be nullified on close or error anyway
      });

    console.log('Recognize stream initialized. Flushing queue if any audio arrived early.');
    // Flush queued audio
    while (audioQueue.length > 0) {
      const chunk = audioQueue.shift();
      if (recognizeStream && recognizeStream.writable) {
        recognizeStream.write(chunk); // CORRECTED: Send raw buffer
      } else {
        console.warn('Stream became non-writable while flushing queue. Re-queuing chunk.');
        audioQueue.unshift(chunk); // Put it back if stream died mid-flush
        break; // Stop flushing if stream is not good
      }
    }
  };

  initializeStream(); // Initialize stream on new WebSocket connection

  ws.on('message', (data) => {
    // Assuming 'data' from client is ArrayBuffer, convert to Node.js Buffer
    const audioChunk = Buffer.isBuffer(data) ? data : Buffer.from(data);

    if (audioChunk.length < 10) { // Basic check for empty/tiny chunks
        // console.log('Received very small audio chunk, skipping.');
        return;
    }

    if (!recognizeStream || !recognizeStream.writable) {
      console.log('Stream not ready or not writable — queuing chunk');
      audioQueue.push(audioChunk);
      if (!recognizeStream) { // If stream died, try to re-initialize
        console.log('RecognizeStream is null, attempting to re-initialize.');
        initializeStream();
      }
      return;
    }

    try {
      recognizeStream.write(audioChunk); // CORRECTED: Send raw buffer
    } catch (error) {
      // This catch is for synchronous errors, e.g., if stream was closed abruptly
      console.error('Synchronous stream write error:', error);
      if (recognizeStream) {
        recognizeStream.destroy();
      }
      recognizeStream = null;
      audioQueue.push(audioChunk); // Queue the chunk that failed to write
      initializeStream(); // Attempt to re-establish the stream
    }
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    if (recognizeStream) {
      console.log('Ending recognize stream due to WebSocket close.');
      recognizeStream.end(); // Gracefully end the stream on Google's side
      recognizeStream.destroy(); // Ensure all resources are freed
    }
    recognizeStream = null;
    audioQueue = []; // Clear queue for this connection
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    if (recognizeStream) {
      recognizeStream.destroy();
    }
    recognizeStream = null;
    audioQueue = [];
  });
});

console.log(`Google Cloud Project ID: ${process.env.GOOGLE_CLOUD_PROJECT}`);