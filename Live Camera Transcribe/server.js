const express = require('express');
const WebSocket = require('ws');
const speech = require('@google-cloud/speech');
const translate = require('@google-cloud/translate');
const path = require('path'); // For serving index.html

// Check for GOOGLE_CLOUD_PROJECT environment variable
if (!process.env.GOOGLE_CLOUD_PROJECT) {
  console.error('FATAL ERROR: GOOGLE_CLOUD_PROJECT environment variable not set.');
  console.error('Translation and potentially other Google Cloud services will fail.');
  console.error('Please set this variable before running the server.');
  process.exit(1); // Exit if critical environment variable is missing
}

const app = express();
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

  const initializeStream = () => {
    const requestConfig = {
      config: {
        encoding: 'WEBM_OPUS',
        sampleRateHertz: 48000, // Opus from browser is typically 48kHz
        languageCode: 'en-US',
        enableAutomaticPunctuation: true,
        // model: 'telephony', // Consider model selection for your use case
        // useEnhanced: true, // For better accuracy, if your project supports it
      },
      interimResults: true,
    };

    console.log('Initializing new Recognize stream...');
    recognizeStream = speechClient
      .streamingRecognize(requestConfig)
      .on('error', (error) => {
        console.error('Speech-to-Text API Error:', error);
        if (recognizeStream) {
            recognizeStream.destroy();
        }
        recognizeStream = null;
        try {
            ws.send(JSON.stringify({ error: `Speech recognition API error: ${error.message}` }));
        } catch (e) { console.error("Error sending error to client:", e); }
      })
      .on('data', async (data) => {
        const transcription = data.results[0]?.alternatives[0]?.transcript || '';
        const isFinal = data.results[0]?.isFinal || false;

        let translation = '';
        let clientData = { transcription, isFinal, translation: 'Translating...' };

        if (isFinal && transcription) {
            console.log('Final Transcription:', transcription);
            try {
                const [response] = await translateClient.translateText({
                  contents: [transcription],
                  mimeType: 'text/plain',
                  sourceLanguageCode: 'en',
                  targetLanguageCode: 'hi',
                  parent: `projects/${process.env.GOOGLE_CLOUD_PROJECT}/locations/global`,
                });
                translation = response.translations[0]?.translatedText || '';
                console.log('Translation:', translation);
                clientData.translation = translation;
            } catch (err) {
                console.error('Translation API error:', err);
                clientData.translation = "[Translation Error]";
            }
        } else if (transcription) {
            // console.log('Interim Transcription:', transcription); // Less noisy logging
        }

        try {
            if (ws.readyState === WebSocket.OPEN) {
                 ws.send(JSON.stringify(clientData));
            }
        } catch (e) { console.error("Error sending data to client:", e); }

      })
      .on('end', () => {
        console.log('Recognize stream ended by API.');
        // It might be an abrupt end from API side, good to nullify
        if (recognizeStream) {
             recognizeStream.destroy(); // ensure cleanup
        }
        recognizeStream = null;
      });

    console.log('Recognize stream initialized. Flushing queue if any audio arrived early.');
    while (audioQueue.length > 0) {
      const chunk = audioQueue.shift();
      if (recognizeStream && recognizeStream.writable) {
        recognizeStream.write(chunk);
      } else {
        console.warn('Stream became non-writable while flushing queue. Re-queuing chunk.');
        audioQueue.unshift(chunk);
        break;
      }
    }
  };

  initializeStream();

  ws.on('message', (data) => {
    const audioChunk = Buffer.isBuffer(data) ? data : Buffer.from(data);

    if (audioChunk.length < 10) {
        return;
    }

    if (!recognizeStream || !recognizeStream.writable) {
      console.log('Stream not ready or not writable — queuing chunk');
      audioQueue.push(audioChunk);
      if (!recognizeStream) {
        console.log('RecognizeStream is null, attempting to re-initialize.');
        initializeStream(); // Attempt to re-initialize if it died
      }
      return;
    }

    try {
      recognizeStream.write(audioChunk);
    } catch (error) {
      console.error('Synchronous stream write error:', error);
      if (recognizeStream) {
        recognizeStream.destroy();
      }
      recognizeStream = null;
      audioQueue.push(audioChunk);
      initializeStream();
    }
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    if (recognizeStream) {
      console.log('Ending recognize stream due to WebSocket close.');
      recognizeStream.end();
      recognizeStream.destroy();
    }
    recognizeStream = null;
    audioQueue = [];
  });

  ws.on('error', (err) => {
    console.error('WebSocket server error for a connection:', err);
    if (recognizeStream) {
      recognizeStream.destroy();
    }
    recognizeStream = null;
    audioQueue = [];
  });
});

console.log(`Google Cloud Project ID for Translation: ${process.env.GOOGLE_CLOUD_PROJECT}`);