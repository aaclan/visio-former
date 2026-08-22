import { useEffect, useRef, useState } from 'react'

function WebcamCapture() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((mediaStream) => {
        if (!active) {
          mediaStream.getTracks().forEach((track) => track.stop())
          return
        }
        setStream(mediaStream)
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Could not access webcam')
      })

    return () => {
      active = false
      stream?.getTracks().forEach((track) => track.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      if (recordedUrl) URL.revokeObjectURL(recordedUrl)
    }
  }, [recordedUrl])

  const startRecording = () => {
    if (!stream) return

    chunksRef.current = []
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl)
      setRecordedUrl(null)
    }

    const recorder = new MediaRecorder(stream)
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data)
    }
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' })
      setRecordedUrl(URL.createObjectURL(blob))
    }

    recorder.start()
    mediaRecorderRef.current = recorder
    setIsRecording(true)
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    setIsRecording(false)
  }

  if (error) {
    return (
      <section id="webcam-capture">
        <p role="alert">Webcam error: {error}</p>
      </section>
    )
  }

  return (
    <section id="webcam-capture">
      <h1>Webcam Capture</h1>

      <video ref={videoRef} autoPlay muted playsInline width={480} height={360} />

      <div className="webcam-controls">
        {!isRecording ? (
          <button type="button" onClick={startRecording} disabled={!stream}>
            Start recording
          </button>
        ) : (
          <button type="button" onClick={stopRecording}>
            Stop recording
          </button>
        )}
      </div>

      {recordedUrl && (
        <div className="webcam-playback">
          <h2>Recording</h2>
          <video src={recordedUrl} controls width={480} height={360} />
          <a href={recordedUrl} download="recording.webm">
            Download recording
          </a>
        </div>
      )}
    </section>
  )
}

export default WebcamCapture
