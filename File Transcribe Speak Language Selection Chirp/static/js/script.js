document.addEventListener('DOMContentLoaded', function () {
    const uploadForm = document.getElementById('uploadForm');
    const videoFileIn = document.getElementById('videoFile');
    const fromLangSelect = document.getElementById('fromLang');
    const toLangSelect = document.getElementById('toLang');
    const voiceSelect = document.getElementById('voiceSelect');
    const videoPlayer = document.getElementById('videoPlayer');
    const transcriptionText = document.getElementById('transcriptionText');
    const translationText = document.getElementById('translationText');
    const transcriptionLangSpan = document.getElementById('transcriptionLang');
    const translationLangSpan = document.getElementById('translationLang');
    const messageArea = document.getElementById('messageArea');
    const processButton = document.getElementById('processButton');
    const voiceOnButton = document.getElementById('voiceOnButton');
    const downloadButton = document.getElementById('downloadButton');
    
    // New UI elements
    const loadingOverlay = document.getElementById('loadingOverlay');
    const resultsContainer = document.getElementById('resultsContainer');

    videoFileIn.addEventListener('change', function(e){
        const fileName = e.target.files[0] ? e.target.files[0].name : "Choose file...";
        e.target.nextElementSibling.innerText = fileName;
        resultsContainer.style.display = 'none';
        messageArea.style.display = 'none';
    });

    uploadForm.addEventListener('submit', async function (event) {
        event.preventDefault();
        const videoFile = videoFileIn.files[0];
        if (!videoFile) {
            messageArea.textContent = 'Please select a video file.';
            messageArea.className = 'alert alert-danger';
            messageArea.style.display = 'block';
            return;
        }

        messageArea.style.display = 'none';
        resultsContainer.style.display = 'none';
        loadingOverlay.classList.add('visible'); // Show the new overlay
        processButton.disabled = true;
        
        transcriptionLangSpan.textContent = fromLangSelect.options[fromLangSelect.selectedIndex].text;
        translationLangSpan.textContent = toLangSelect.options[toLangSelect.selectedIndex].text;

        const formData = new FormData();
        formData.append('videoFile', videoFile);
        formData.append('fromLang', fromLangSelect.value);
        formData.append('toLang', toLangSelect.value);
        formData.append('voice', voiceSelect.value);

        try {
            const response = await fetch('/translate-video', { method: 'POST', body: formData });
            const result = await response.json();
            if (!response.ok) { throw new Error(result.error || `HTTP error! Status: ${response.status}`); }

            resultsContainer.style.display = 'flex'; // Show the new results layout
            transcriptionText.value = result.transcript;
            translationText.value = result.translation;

            if (result.translated_video_url) {
                videoPlayer.src = result.translated_video_url;
                videoPlayer.load();
                videoPlayer.play().catch(e => console.warn("Autoplay was prevented:", e));
                downloadButton.href = result.translated_video_url;
                const originalFileName = videoFileIn.files[0].name.split('.').slice(0, -1).join('.');
                downloadButton.setAttribute('download', `${originalFileName}_translated.mp4`);
            } else {
                throw new Error(result.error || "Translated video URL not found in server response.");
            }
        } catch (error) {
            console.error('Error during processing:', error);
            messageArea.textContent = `Error: ${error.message}`;
            messageArea.className = 'alert alert-danger mt-3';
            messageArea.style.display = 'block';
        } finally {
            loadingOverlay.classList.remove('visible');
            processButton.disabled = false;
        }
    });

    voiceOnButton.addEventListener('click', () => {
        if (videoPlayer.src) {
            videoPlayer.muted = !videoPlayer.muted;
            if (videoPlayer.muted) {
                voiceOnButton.innerHTML = `<i class="fas fa-volume-mute"></i> Voice OFF`;
                voiceOnButton.classList.replace('btn-info', 'btn-secondary');
            } else {
                voiceOnButton.innerHTML = `<i class="fas fa-volume-up"></i> Voice ON`;
                voiceOnButton.classList.replace('btn-secondary', 'btn-info');
            }
        }
    });
});