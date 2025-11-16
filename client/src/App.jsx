import { useState, useRef } from "react";
import "./App.css";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

function App() {
  const [title, setTitle] = useState("");
  const [slidesFile, setSlidesFile] = useState(null);
  const [mediaFile, setMediaFile] = useState(null); // audio or video
  const [lectureId, setLectureId] = useState(null);
  const [transcript, setTranscript] = useState("");
  const [answer, setAnswer] = useState("");
  const [question, setQuestion] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  const [mediaUrl, setMediaUrl] = useState(null);

  // VR controls
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // Voice question recording
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!slidesFile || !mediaFile) {
      return alert("Slides and media (audio/video) are required.");
    }

    const formData = new FormData();
    formData.append("slides", slidesFile);
    // Backend expects this field name as 'audio' – we can still send video here.
    formData.append("audio", mediaFile);
    if (title) formData.append("title", title);

    setIsUploading(true);
    setAnswer("");
    setQuestion("");
    try {
      const res = await fetch(`${API_BASE}/api/upload-lecture`, {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Upload failed");
      }
      setLectureId(data.lectureId);
      setTranscript(data.transcript);
      setTitle(data.title || "");

      // Create a local URL for playback
      const url = URL.createObjectURL(mediaFile);
      setMediaUrl(url);
    } catch (err) {
      console.error(err);
      alert("Error uploading lecture. See console.");
    } finally {
      setIsUploading(false);
    }
  };

  // --- Play / Pause video (VR button) ---
  const togglePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const handleVideoPlay = () => setIsPlaying(true);
  const handleVideoPause = () => setIsPlaying(false);

  // --- Voice question recording (VR button) ---
  const startRecording = async () => {
    if (!lectureId) {
      alert("Upload and index a lecture first.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);

      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        // Stop mic
        stream.getTracks().forEach((track) => track.stop());

        try {
          const formData = new FormData();
          formData.append("questionAudio", blob, "question.webm");
          formData.append("lectureId", lectureId);

          const res = await fetch(`${API_BASE}/api/ask-voice`, {
            method: "POST",
            body: formData
          });

          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || "Voice question failed");
          }

          // Show what Gemini answered *and* the recognized question
          setQuestion(data.questionText);
          setAnswer(data.answer);
        } catch (err) {
          console.error(err);
          alert("Error sending voice question. See console.");
        } finally {
          setIsRecording(false);
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error(err);
      alert("Could not access microphone. Check permissions.");
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    recorder.stop();
  };

  const handleRecordButtonClick = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>✨ LectureLens VR View</h1>
        <p>Upload a lecture, then control playback and ask spoken questions.</p>
      </header>

      {/* Upload section - only shown before lecture is loaded */}
      {!lectureId || !mediaUrl ? (
        <section className="panel upload-panel">
          <h2>📚 Upload lecture & slides</h2>
          <form onSubmit={handleUpload} className="upload-form">
            <label>
              Lecture title
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Neural Networks Lecture 1"
              />
            </label>

            <label>
              Slides (PDF)
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => setSlidesFile(e.target.files[0] || null)}
              />
            </label>

            <label>
              Lecture media (audio or video)
              <input
                type="file"
                accept="audio/*,video/*"
                onChange={(e) => setMediaFile(e.target.files[0] || null)}
              />
            </label>

            <button type="submit" disabled={isUploading}>
              {isUploading ? "Processing..." : "Upload & Index"}
            </button>
          </form>
        </section>
      ) : (
        /* SPLIT-SCREEN VIEW: Left side = lecture + transcript, Right side = Q&A chat */
        <main className="vr-layout split-screen-active">
          <section className="vr-video-panel">
            <h2>🎥 Lecture</h2>
            <div className="vr-video-wrapper">
              <video
                ref={videoRef}
                src={mediaUrl}
                onPlay={handleVideoPlay}
                onPause={handleVideoPause}
                controls={false}
                className="vr-video"
              />
              <button
                className="vr-primary-button"
                onClick={togglePlayPause}
                disabled={!mediaUrl}
              >
                {isPlaying ? "⏸ Pause" : "▶ Play"}
              </button>
            </div>

            {transcript && (
              <section className="split-transcript">
                <h3>📝 Transcript</h3>
                <textarea value={transcript} readOnly rows={8} />
              </section>
            )}
          </section>

          <section className="vr-qa-panel">
            <h2>💬 Chat & Q&A</h2>
            <p className="hint">
              Ask spoken questions about the lecture content.
            </p>

            <button
              className={`vr-primary-button vr-record-button ${
                isRecording ? "recording" : ""
              }`}
              onClick={handleRecordButtonClick}
              disabled={!lectureId}
            >
              {isRecording ? "⏹ Stop & Ask" : "🎙 Record Question"}
            </button>

            {question && (
              <div className="vr-question-block">
                <h3>Your Question</h3>
                <p>{question}</p>
              </div>
            )}

            {answer && (
              <div className="vr-answer-block">
                <h3>Answer</h3>
                <p>{answer}</p>
              </div>
            )}
          </section>
        </main>
      )}
    </div>
  );
}

export default App;
