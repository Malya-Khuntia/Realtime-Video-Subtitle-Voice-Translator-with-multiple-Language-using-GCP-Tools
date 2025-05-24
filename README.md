# Bridging Worlds 🌍: Introducing the Realtime Video Subtitle & Voice Translator 🎙️➡️🗣️

This project provides a web-based application for realtime transcription of video audio, translation of the transcription into a target language, and optional voice-over of the translated text. It leverages Google Cloud AI services for high-quality results and is designed to be deployed as a scalable service on Google Cloud Run.

## Features

*   **Live Transcription:** Captures audio from a playing video file and transcribes it in near real-time.
*   **Dynamic Language Selection:** Users can select both the source language (for transcription) and the target language (for translation and voice-over) from a dropdown menu.
*   **Realtime Translation:** Transcribed text is immediately translated into the selected target language.
*   **Optional Voice-Over:** The translated text can be synthesized into speech in the target language and played back. Users can toggle this feature ON/OFF.
*   **WebSockets for Realtime Communication:** Uses WebSockets to stream audio data from the client (browser) to the server and to send transcription/translation results back to the client.
*   **Attractive UI:** A user-friendly interface for video playback, language selection, and viewing outputs.
*   **Scalable Backend:** Designed to be deployed on Google Cloud Run, allowing it to scale based on demand.

## Technology Stack

### Backend

*   **Node.js:** JavaScript runtime environment.
*   **Express.js:** Web application framework for Node.js (used to serve the HTML page).
*   **`ws` (WebSocket library):** For handling WebSocket connections between client and server.
*   **Google Cloud APIs:**
    *   **Speech-to-Text API:** For converting audio streams into text.
    *   **Translation API:** For translating text from one language to another.
    *   **Text-to-Speech API:** For synthesizing text into natural-sounding speech.

### Frontend

*   **HTML5:** Structure of the web page.
*   **CSS3:** Styling the web page for an attractive and responsive look.
*   **JavaScript (Vanilla):** Handling client-side logic, DOM manipulation, WebSocket communication, and `MediaRecorder` API usage.
    *   **`MediaRecorder` API:** To capture audio from the video element.
    *   **Web Audio API (`AudioContext`):** To decode and play back synthesized speech.
*   **Font Awesome:** For icons (e.g., microphone toggle).

### Cloud Platform & Tools

*   **Google Cloud Platform (GCP):** Hosting and AI services.
*   **Google Cloud Run:** Serverless platform to deploy the containerized application.
*   **Google Cloud Build:** To automate the building of the Docker container.
*   **Google Artifact Registry (or Container Registry):** To store Docker container images.
*   **Docker:** For containerizing the application.

## Project Hierarchy

```

├── Dockerfile # Instructions to build the Docker container
├── index.html # Frontend HTML, CSS, and client-side JavaScript
├── package-lock.json # Exact versions of npm dependencies
├── package.json # Project metadata and npm dependencies
├── server.js # Backend Node.js server logic (Express, WebSockets, Google API calls)
├── .gcloudignore # Specifies files to ignore during gcloud deployments
└── README.md # This file

```

## APIs and Services Used

1.  **Google Cloud Speech-to-Text API:**
    *   **Purpose:** Converts audio streamed from the client's video into written text.
    *   **Features Used:** Streaming recognition, automatic punctuation, language selection.
    *   **Enablement:** Requires the "Cloud Speech-to-Text API" to be enabled in your GCP project.

2.  **Google Cloud Translation API:**
    *   **Purpose:** Translates the transcribed text from the source language to the selected target language.
    *   **Features Used:** Text translation, source/target language specification.
    *   **Enablement:** Requires the "Cloud Translation API" to be enabled in your GCP project.

3.  **Google Cloud Text-to-Speech API:**
    *   **Purpose:** Converts the translated text into audible speech (voice-over).
    *   **Features Used:** Text synthesis, voice selection (based on language and locale), MP3 audio encoding.
    *   **Enablement:** Requires the "Cloud Text-to-Speech API" to be enabled in your GCP project.

4.  **Google Cloud Run:**
    *   **Purpose:** Hosts and scales the backend `server.js` application.
    *   **Features Used:** Managed platform, container deployment, automatic scaling (including to zero), session affinity (for WebSockets), HTTPS endpoint.
    *   **Enablement:** Requires the "Cloud Run API" to be enabled.

5.  **Google Cloud Build & Artifact Registry:**
    *   **Purpose:** Automate the process of building the Docker image from the source code and storing it.
    *   **Enablement:** Requires "Cloud Build API" and "Artifact Registry API" (or "Container Registry API") to be enabled.

## Google Cloud Services Setup

Before running the project, you need to set up the necessary Google Cloud services and authentication.

1.  **Create a Google Cloud Project:**
    *   Go to the [Google Cloud Console](https://console.cloud.google.com/).
    *   Create a new project or select an existing one.

2.  **Enable APIs:**
    For your project, enable the following APIs:
    *   **Cloud Speech-to-Text API**
    *   **Cloud Translation API**
    *   **Cloud Text-to-Speech API**
    You can enable them by searching for them in the API Library in the GCP Console.

3.  **Set up Authentication:**
    The Node.js server needs to authenticate with Google Cloud to use these APIs. The recommended way for local development is to use Application Default Credentials (ADC):
    *   Install the Google Cloud CLI (`gcloud`): [Installation Guide](https://cloud.google.com/sdk/docs/install).
    *   Authenticate with your Google account:
        ```bash
        gcloud auth login
        ```
    *   Set up Application Default Credentials:
        ```bash
        gcloud auth application-default login
        ```
    This command will open a browser window for you to log in. After successful authentication, the client libraries will automatically find these credentials.

4.  **Set the Google Cloud Project Environment Variable:**
    The `server.js` file requires the `GOOGLE_CLOUD_PROJECT` environment variable to be set to your GCP Project ID.
    *   **Linux/macOS:**
        ```bash
        export GOOGLE_CLOUD_PROJECT="your-gcp-project-id"
        ```
    *   **Windows (Command Prompt):**
        ```bash
        set GOOGLE_CLOUD_PROJECT="your-gcp-project-id"
        ```
    *   **Windows (PowerShell):**
        ```bash
        $env:GOOGLE_CLOUD_PROJECT="your-gcp-project-id"
        ```
    Replace `"your-gcp-project-id"` with your actual Project ID.

4.  **Billing:** Ensure that billing is enabled for your Google Cloud Project, as these APIs are paid services (though they have free tiers which might be sufficient for initial development and testing).

## Setup and Installation (Local Development)

### Prerequisites

*   **Node.js and npm:** Install Node.js (which includes npm) from [nodejs.org](https://nodejs.org/). Version 18.x or later is recommended.
*   **Google Cloud SDK (`gcloud`):** Install and initialize the Google Cloud SDK. Follow the instructions [here](https://cloud.google.com/sdk/docs/install).
*   **Google Cloud Project:** A GCP project with billing enabled.
*   **Enable APIs:** Ensure Cloud Speech-to-Text, Translation, and Text-to-Speech APIs are enabled for your project.
*   **Authentication:** Authenticate the `gcloud` CLI for Application Default Credentials:
    ```bash
    gcloud auth application-default login
    ```

### Steps

1.  **Clone the repository (or download the files):**
    ```bash
    # If you have it in a git repository:
    # git clone <your-repo-url>
    # cd <your-repo-directory>
    ```
    Ensure `server.js` and `index.html` are in the project root. If running in Google Cloud Shell, use its terminal.

2.  **Initialize NPM Project (if no `package.json` exists):**
    If you don't have a `package.json` file yet, run:
    ```bash
    npm init -y
    ```
    This creates a default `package.json` file.

3.  **Install Backend Dependencies:**
    Run the following command to install the required Node.js modules:
    ```bash
    npm install express ws @google-cloud/speech @google-cloud/translate @google-cloud/text-to-speech
    ```
    This will download the packages and save them in the `node_modules` directory and update your `package.json` and `package-lock.json`.

4.  **Run the Server Locally:**
    ```bash
    node server.js
    ```
    You should see output like:
    ```
    [Server] Using GOOGLE_CLOUD_PROJECT: your-gcp-project-id
    [Server] Project ID: your-gcp-project-id
    [Server] Available languages configured.
    [Server] HTTP Live Streaming Server running on port 8080 (for Cloud Shell proxy)
    ```

5.  **Access the Application:**
    Open your web browser and go to `http://localhost:8080`.
    You should see the web interface. Select languages, choose a video file, and press play to test.

## Deployment to Google Cloud Run

Follow these steps to deploy the application to Google Cloud Run for global availability.

### Prerequisites for Deployment

*   Google Cloud SDK (`gcloud`) installed and authenticated.
*   A GCP project with billing enabled.
*   The following APIs enabled in your GCP project:
    *   Cloud Run API
    *   Cloud Build API
    *   Artifact Registry API (or Container Registry API)
    *   (Speech-to-Text, Translation, Text-to-Speech APIs should already be enabled from local setup)
*   Docker installed locally (optional, as Cloud Build can handle it, but good for local testing of the Dockerfile).
*   Your `Dockerfile` and source code are ready.

### Deployment Steps

1.  **Navigate to Project Directory:**
    Open your terminal or command prompt and navigate to the root directory of the project (where `server.js` is located).
    ```bash
    cd path/to/your/project-directory
    ```

2.  **Creat Dockerfile file:**
    ```bash
    cat <<EOF > Dockerfile
    FROM node:18-slim
    WORKDIR /usr/src/app
    COPY package*.json ./
    RUN npm install --omit=dev
    COPY . .
    EXPOSE 8080
    CMD ["node", "server.js"]
    EOF
    ```

3.  **Creat .gcloudignore file:**
    ```bash
    cat <<EOF > .gcloudignore
    .gcloudignore
    node_modules/
    npm-debug.log
    .dockerignore
    *.key
    *.crt
    .git
    .vscode
    EOF
    ```

3.  **Ensure your `Dockerfile` and `.gcloudignore` files are correctly set up in your project root.** (Refer to previous discussions for correct content).

4.  **Set your Project ID and Region (in Cloud Shell or your terminal):**
    ```bash
    gcloud config set project YOUR_PROJECT_ID
    REGION="asia-south1" # Or your preferred Cloud Run region
    ```

5.  **(One-time) Create an Artifact Registry Docker repository (if you haven't already):**
    ```bash
    ARTIFACT_REPO_NAME="your-app-repo" # Choose a repository name
    gcloud artifacts repositories create ${ARTIFACT_REPO_NAME} \
        --repository-format=docker \
        --location=${REGION} \
        --description="Docker repository for my applications"
    ```

6.  **Define Service and Image Names:**
    ```bash
    SERVICE_NAME="realtime-video-translator" # Name for your Cloud Run service
    PROJECT_ID=$(gcloud config get-value project)
    IMAGE_NAME="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPO_NAME}/${SERVICE_NAME}"
    ```

7.  **Deploy to Cloud Run:**
    Navigate to your project's root directory (containing the `Dockerfile`) and run:
    ```bash
    gcloud run deploy ${SERVICE_NAME} \
      --source . \
      --image ${IMAGE_NAME}:latest \
      --platform managed \
      --region ${REGION} \
      --allow-unauthenticated \
      --port 8080 \
      --session-affinity \
      --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID}" \
      --timeout=600 # Optional: Increase timeout for longer processing or WebSocket sessions (default is 300s)
      # --cpu=1 # Optional: Specify CPU allocation
      # --memory=512Mi # Optional: Specify memory allocation
      # --min-instances=0 # Default, scales to zero for cost savings
    ```
    *   `--source .`: Builds the container from the current directory.
    *   `--allow-unauthenticated`: Makes the service publicly accessible.
    *   `--port 8080`: Informs Cloud Run your application inside the container listens on port 8080.
    *   `--session-affinity`: **Crucial for WebSockets** to ensure a client stays connected to the same instance.
    *   `--set-env-vars`: Sets the necessary environment variable for your application.

8.  **Access the Deployed Service:**
    After successful deployment, `gcloud` will output a **Service URL** (e.g., `https://realtime-video-translator-xxxxxx-as.a.run.app`). Open this URL in your browser.

### Managing the Deployed Service (Start/Stop for Cost)

*   **Automatic Scaling to Zero:** Cloud Run automatically scales to zero instances when there's no traffic, minimizing costs.
*   **"Stopping" (Making Private):** To prevent public access and stop invocations:
    ```bash
    gcloud run services remove-iam-policy-binding ${SERVICE_NAME} \
      --member="allUsers" \
      --role="roles/run.invoker" \
      --platform=managed \
      --region=${REGION}
    ```
*   **"Starting" (Making Public Again):**
    ```bash
    gcloud run services add-iam-policy-binding ${SERVICE_NAME} \
      --member="allUsers" \
      --role="roles/run.invoker" \
      --platform=managed \
      --region=${REGION}
    ```
*   **Deleting the Service (Definitive Stop):**
    ```bash
    gcloud run services delete ${SERVICE_NAME} \
      --platform=managed \
      --region=${REGION} \
      --quiet
    ```
    To start again after deletion, you'll need to redeploy using the `gcloud run deploy` command.

## Troubleshooting

*   **`Error: Cannot find module 'module-name'` (e.g., `express`, `ws`):**
    Make sure you have run `npm install express ws @google-cloud/speech @google-cloud/translate @google-cloud/text-to-speech` in your project directory.
*   **GCP API Errors (e.g., "Permission Denied", "API not enabled"):**
    *   Ensure the correct APIs are enabled in your GCP project.
    *   Verify that your `gcloud auth application-default login` was successful and that the correct project is set.
    *   Check if the `GOOGLE_CLOUD_PROJECT` environment variable is set correctly in the terminal session running `server.js`.
    *   Ensure billing is enabled for your project.
*   **No Audio/Transcription Output:**
    *   Open your browser's developer console (usually F12) and the Node.js server terminal.
    *   Look for error messages or `console.log` outputs that might indicate where the process is failing (e.g., WebSocket connection issues, MediaRecorder errors, server-side API errors).
    *   Ensure your microphone/video audio source is working and browser has permission if using live input (though this project is file-based).
*   **`index.html` Not Loading (e.g., "Cannot GET /"):**
    *   Ensure `server.js` is running.
    *   Verify `index.html` is in the same directory as `server.js` and named correctly.
    *   Check the server logs for any errors related to serving the file.
*   **Local Issues:** Check browser console and Node.js terminal for errors. Ensure environment variables are set and APIs are enabled.
*   **Cloud Run Deployment Issues:**
    *   `Dockerfile not found`: Ensure `Dockerfile` is in the root and not in `.gcloudignore`.
    *   Build failures: Check Cloud Build logs in the GCP Console.
    *   Service startup errors: Check Cloud Run service logs for your `server.js` output and any runtime errors.
    *   Permission denied (for Google APIs): Verify the Cloud Run service account has the necessary IAM roles (Cloud Speech Service Agent, Cloud Translation API User, Cloud Text-to-Speech Service Agent).
*   **WebSocket Issues on Cloud Run:** Ensure `--session-affinity` was used during deployment. Check client and server logs for connection errors.

## Further Development / Potential Enhancements

*   **More Robust Error Handling:** Add more comprehensive error handling on both client and server.
*   **User Feedback:** Improve UI feedback during processing stages (e.g., loading indicators, more detailed status messages).
*   **Advanced Language Mapping:** For `translateClient.detectLanguage` (if re-enabled) vs. `speechClient` language codes, implement a more robust mapping if needed (e.g., 'en' to 'en-US').
*   **FFmpeg for Audio Normalization (If needed):** If input audio quality/volume varies wildly, server-side FFmpeg could be used to normalize it before sending to Speech-to-Text.
*   **Support for Live Microphone Input:** Adapt the client-side to use `navigator.mediaDevices.getUserMedia({ audio: true })` instead of video file `captureStream()` for direct voice input.
*   **More Sophisticated Timing for Voice-over:** The current live TTS playback is sequential. True timeline synchronization is highly complex.
*   **Glossaries for Translation:** If specific medical or technical terms need precise handling (e.g., not translating them), implement Google Translation API glossaries.