# AI Video Dubbing & Translation Studio 🎬

This project provides a robust, web-based application that automates the process of video dubbing. It takes a video file, intelligently transcribes the audio, translates the text, and generates a new, downloadable video file with a high-quality, synthesized voiceover in the target language. It is built on a scalable Python backend and leverages Google's most advanced AI services.

## Features

*   **Accurate Batch Transcription:** Processes an entire uploaded video file to generate a full, punctuated transcript using Google's state-of-the-art speech models.
*   **Robust STT Fallback System:** Intelligently attempts to use the advanced **Chirp** model first and automatically falls back to the classic v1 model if needed, ensuring maximum compatibility and success.
*   **Batch Translation & Dubbing:** Translates the entire transcript and synthesizes the complete voiceover in a highly efficient, parallelized manner, resulting in a new, ready-to-use video file.
*   **Dynamic Language & Voice Selection:** Users can select the source and target languages from an extensive list and choose from a selection of premium voices for the final dub.
*   **Efficient, Optimized Processing:** The backend is optimized to run translation and Text-to-Speech tasks concurrently, significantly reducing the overall processing time compared to a sequential approach.
*   **Attractive "Studio" UI:** A modern, user-friendly interface that presents the final video alongside its corresponding transcription and translation for easy comparison.
*   **Scalable Backend:** Built with a production-ready Python stack (Flask + Gunicorn) and designed for serverless deployment on Google Cloud Run, allowing it to handle long-running tasks and scale on demand.

---

## Technology Stack

### Backend

*   **Python:** The core programming language.
*   **Flask:** A lightweight web framework for serving the UI and handling API requests.
*   **Gunicorn:** A production-grade WSGI HTTP server to run the Flask application.
*   **Pydub:** A powerful Python library for audio manipulation and creating silent audio tracks.
*   **Google Cloud APIs:**
    *   **Speech-to-Text API:**
        *   Leverages **Google's Chirp Universal Speech Model** via v2 API Recognizers for broad, high-quality language support.
        *   Includes an automatic fallback to the classic v1 API (`long_running_recognize`) for maximum robustness.
    *   **Translation API:** For efficient batch translation of text segments.
    *   **Text-to-Speech API:** For synthesizing translated text into natural-sounding speech with various voice options.

### Frontend

*   **HTML5 & CSS3:** For the structure and modern styling of the web page.
*   **JavaScript (Vanilla):** For all client-side logic, including form submission, dynamic UI updates, and handling results.
*   **Bootstrap & Font Awesome:** For a responsive layout and clean iconography.

### Cloud Platform & Tools

*   **Google Cloud Platform (GCP):** For hosting, deployment, and AI services.
*   **Google Cloud Run:** The target serverless platform for deploying the containerized application.
*   **Google Cloud Build:** For automatically building the Docker container from source.
*   **Google Artifact Registry:** For securely storing and managing the application's Docker container images.
*   **Docker:** For containerizing the entire application and its dependencies.

---

## Project Evolution: From Realtime Streaming to Batch Processing

This project represents a significant architectural evolution from a previous Node.js/WebSocket-based version. While the initial goal was "realtime" translation, the more practical and higher-quality use case is to produce a finished, shareable video file. The current Python architecture is optimized for this final goal.

| Feature               | Old Project (Node.js/WebSocket)                               | Current Project (Python/Flask)                                                                       |
| --------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Architecture**      | Realtime Streaming                                            | **Batch File Processing**                                                                            |
| **Backend Tech**      | Node.js, Express, `ws` library                                | **Python, Flask, Gunicorn**                                                                          |
| **User Workflow**     | User plays a video, and text appears live.                    | **User uploads a video, waits for processing, and receives a complete, new video file.**             |
| **Speech-to-Text**    | Used basic v1 streaming recognition.                          | **Uses the advanced Chirp model with an automatic fallback to v1, ensuring higher success rates.** |
| **Output**            | Text overlays on the UI; audio played back live in sequence.  | **A new, downloadable MP4 video file** with the original video stream and a dubbed audio track.      |
| **Performance**       | Limited by sequential, real-time API calls.                   | **Highly optimized** with batch translation and concurrent Text-to-Speech API calls.               |
| **Primary Goal**      | Proof-of-concept for live translation display.                | **Production of a high-quality, shareable, dubbed video asset.**                                     |

The current Python-based architecture was chosen because it delivers a more polished and useful final product—a complete video file—and is better suited for handling the long-running, resource-intensive tasks of video processing in a scalable cloud environment.

---

## Project Hierarchy

```
your-project-folder/
├── app.py                 # The core Python/Flask backend logic
├── Dockerfile             # Instructions to build the Docker container
├── requirements.txt       # Python dependencies
├── templates/
│   └── index.html         # The main HTML user interface
└── static/
    ├── css/
    │   └── style.css      # Custom styles for the UI
    └── js/
        └── script.js      # Client-side JavaScript logic
```

---

## Google Cloud Services Setup

Before running the project, you must set up the necessary Google Cloud services and authentication.

1.  **Create a Google Cloud Project** and enable billing.
2.  **Enable APIs:** In your GCP project, enable the following APIs:
    *   Cloud Speech-to-Text API
    *   Cloud Translation API
    *   Cloud Text-to-Speech API
    *   Cloud Run API
    *   Cloud Build API
    *   Artifact Registry API
3.  **Set up Authentication:** For local development, the client libraries use Application Default Credentials (ADC).
    *   Install the Google Cloud CLI (`gcloud`).
    *   Run `gcloud auth application-default login` and follow the browser-based login flow.
4.  **Create Service Account Recognizers (for Chirp):** For each "From" language you wish to support, you must create a Speech-to-Text Recognizer. This is a one-time setup. See deployment steps for scripts.

---

## Setup and Installation (Local Development)

### Prerequisites

*   Python 3.9+ and `pip`.
*   A Google Cloud Project with the APIs enabled and authentication configured (as above).
*   **FFmpeg:** A command-line tool for video and audio processing. It must be installed and accessible in your system's PATH.

### Steps

1.  **Clone the repository (or download the files):**
    ```bash
    # If you have it in a git repository:
    git clone <your-repo-url>
    cd <your-repo-directory>
    ```
2.  **Create a Virtual Environment:**
    ```bash
    python -m venv venv
    source venv/bin/activate  # On Linux/macOS
    # venv\Scripts\activate   # On Windows
    ```
3.  **Install Dependencies:**
    ```bash
    pip install -r requirements.txt
    ```
4.  **Run the Server Locally:**
    The `app.py` is configured to run locally for testing.
    ```bash
    python app.py
    ```
5.  **Access the Application:** Open your browser to `http://localhost:8080`.

---

## Deployment to Google Cloud Run

This workflow uses your preferred command structure to deploy the application.

1.  **Prepare for Deployment:** Ensure your `Dockerfile`, `requirements.txt`, and `.gcloudignore` files are present and correct in your project root. Also, ensure the local development server block (`if __name__ == '__main__':`) exists in `app.py` for local testing, but remember Gunicorn will be used on Cloud Run.

2.  **Set Configuration Variables:**
    ```bash
    gcloud config set project YOUR_PROJECT_ID
    REGION="us-central1" # Or your preferred region
    ARTIFACT_REPO_NAME="video-dubbing-repo" # A name for your container repository
    ```

3.  **(One-Time) Create Artifact Registry Repository:**
    ```bash
    gcloud artifacts repositories create ${ARTIFACT_REPO_NAME} \
        --repository-format=docker \
        --location=${REGION}
    ```

4.  **Deploy:**
    ```bash
    SERVICE_NAME="ai-video-dubbing-studio"
    PROJECT_ID=$(gcloud config get-value project)
    IMAGE_NAME="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPO_NAME}/${SERVICE_NAME}"

    gcloud run deploy ${SERVICE_NAME} \
      --source . \
      --image ${IMAGE_NAME}:latest \
      --platform managed \
      --region ${REGION} \
      --allow-unauthenticated \
      --port 8080 \
      --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID}" \
      --timeout=600 \
      --cpu=2 \
      --memory=4Gi
    ```

5.  **Access the Deployed Service:** After deployment, `gcloud` will provide the public **Service URL**.

---

## Troubleshooting

*   **`ModuleNotFoundError`:** Ensure you have activated your virtual environment (`source venv/bin/activate`) before running `pip install` or `python app.py`.
*   **GCP API Errors ("Permission Denied"):** Verify that the APIs are enabled and that your service account (either your user account for local dev or the Cloud Run service account) has the necessary IAM roles (`Storage Object Admin`, `Cloud Translation API User`, etc.).
*   **No Transcription / Silent Video:** The most common cause is the STT model failing to detect audio.
    *   Set `STT_STRATEGY = 'BEST_EFFORT'` in `app.py` to allow the robust fallback system to work.
    *   Ensure the source video has a clear audio track.
*   **Cloud Run "Container Failed to Start":** This is often a generic error for a crash on startup. Check the **Cloud Run Logs** for the specific revision to find the real error, which could be a missing dependency, a failed API client initialization, or a syntax error.
