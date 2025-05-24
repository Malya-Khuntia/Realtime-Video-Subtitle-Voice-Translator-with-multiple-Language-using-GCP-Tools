const express = require('express'); // Make sure express is required
const WebSocket = require('ws');
const speech = require('@google-cloud/speech');
const translate = require('@google-cloud/translate');
const path = require('path');

// Check for GOOGLE_CLOUD_PROJECT environment variable
if (!process.env.GOOGLE_CLOUD_PROJECT) {
  console.error('FATAL ERROR: GOOGLE_CLOUD_PROJECT environment variable not set.');
  console.error('Speech-to-Text and Translation services will fail.');
  console.error('Please set this variable before running the server.');
  process.exit(1);
}

// ****** CONFIGURATION (GLOBAL SCOPE FOR THIS MODULE) ******
const SOURCE_LANGUAGE_CODE_FOR_TRANSCRIPTION = 'en-US'; // e.g., 'en-US', 'es-ES', 'ja-JP'
                                                     // This is the language of the audio in the video.
const TARGET_LANGUAGE_CODE_FOR_TRANSLATION = 'hi';   // Hindi
// **********************************************************

const app = express(); // Initialize express app
const server = app.listen(8080, () => {
  console.log('Server running on port 8080');
});
const wss = new WebSocket.Server({ server });

const speechClient = new speech.SpeechClient();
const translateClient = new translate.TranslationServiceClient();

// Serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  let recognizeStream = null;
  let audioQueue = [];

  const initializeGoogleStream = () => {
    const requestConfig = {
      config: {
        encoding: 'WEBM_OPUS',
        sampleRateHertz: 48000,
        languageCode: SOURCE_LANGUAGE_CODE_FOR_TRANSCRIPTION, // Uses global constant
        enableAutomaticPunctuation: true,
      },
      interimResults: true,
    };

    console.log(`Initializing Google Speech stream for language: ${SOURCE_LANGUAGE_CODE_FOR_TRANSCRIPTION}`);
    recognizeStream = speechClient
      .streamingRecognize(requestConfig)
      .on('error', (error) => {
        console.error('Google Speech API Error:', error);
        if (recognizeStream) recognizeStream.destroy();
        recognizeStream = null;
        try {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ error: `Speech API error: ${error.message}` }));
            }
        } catch (e) { console.error("Error sending API error to client:", e); }
      })
      .on('data', async (data) => { // Marked as async
        const transcription = data.results[0]?.alternatives[0]?.transcript || '';
        const isFinal = data.results[0]?.isFinal || false;

        let translation = 'Translating...'; // Default for interim
        let clientData = { transcription, isFinal, translation };

        if (isFinal && transcription) {
            console.log(`Final Transcription (${SOURCE_LANGUAGE_CODE_FOR_TRANSCRIPTION}): ${transcription}`);
            try {
                const [response] = await translateClient.translateText({
                  contents: [transcription],
                  mimeType: 'text/plain',
                  sourceLanguageCode: SOURCE_LANGUAGE_CODE_FOR_TRANSCRIPTION.split('-')[0], // e.g., 'en'
                  targetLanguageCode: TARGET_LANGUAGE_CODE_FOR_TRANSLATION, // Uses global constant
                  parent: `projects/${process.env.GOOGLE_CLOUD_PROJECT}/locations/global`,
                });
                translation = response.translations[0]?.translatedText || '[Translation Unavailable]';
                console.log(`Translation (to ${TARGET_LANGUAGE_CODE_FOR_TRANSLATION}): ${translation}`);
                clientData.translation = translation;
            } catch (err) {
                console.error('Translation API error:', err);
                clientData.translation = "[Translation Error]";
            }
        } else if (transcription) {
            // console.log(`Interim Transcription (${SOURCE_LANGUAGE_CODE_FOR_TRANSCRIPTION}): ${transcription}`);
        }

        try {
            if (ws.readyState === WebSocket.OPEN) {
                 ws.send(JSON.stringify(clientData));
            }
        } catch (e) { console.error("Error sending data to client:", e); }
      })
      .on('end', () => {
        console.log('Google Speech Recognize stream ended by API.');
        if (recognizeStream) recognizeStream.destroy();
        recognizeStream = null;
      });

    console.log('Google Speech stream initialized. Flushing queue if any audio arrived early.');
    while (audioQueue.length > 0) {
      const chunk = audioQueue.shift();
      if (recognizeStream && recognizeStream.writable) {
        recognizeStream.write(chunk);
      } else {
        console.warn('Google stream became non-writable while flushing. Re-queuing chunk.');
        audioQueue.unshift(chunk);
        break;
      }
    }
  };

  initializeGoogleStream();

  ws.on('message', (data) => {
    const audioChunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (audioChunk.length < 10) return;

    if (!recognizeStream || !recognizeStream.writable) {
      console.log('Google stream not ready/writable — queuing chunk');
      audioQueue.push(audioChunk);
      if (!recognizeStream) {
        console.log('Google stream is null, attempting to re-initialize.');
        initializeGoogleStream();
      }
      return;
    }
    try {
      recognizeStream.write(audioChunk);
    } catch (error) {
      console.error('Synchronous Google stream write error:', error);
      if (recognizeStream) recognizeStream.destroy();
      recognizeStream = null;
      audioQueue.push(audioChunk);
      initializeGoogleStream();
    }
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    if (recognizeStream) {
      console.log('Ending Google Speech stream due to WebSocket close.');
      recognizeStream.end();
      recognizeStream.destroy();
    }
    recognizeStream = null;
    audioQueue = [];
  });

  ws.on('error', (err) => {
    console.error('WebSocket server error for a connection:', err);
    if (recognizeStream) recognizeStream.destroy();
    recognizeStream = null;
    audioQueue = [];
  });
}); // End of wss.on('connection')

// This console.log can now access the global constants
console.log(`Server configured for Transcription from '${SOURCE_LANGUAGE_CODE_FOR_TRANSCRIPTION}' and Translation to '${TARGET_LANGUAGE_CODE_FOR_TRANSLATION}'.`);
console.log(`Using Google Cloud Project ID (implicitly by SDK): ${process.env.GOOGLE_CLOUD_PROJECT || 'Not Set (SDK will try to find default)'}`);