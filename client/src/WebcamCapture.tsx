import { useEffect, useRef, useState } from 'react'

const RECORDING_MIME_TYPE = MediaRecorder.isTypeSupported('video/mp4')
  ? 'video/mp4'
  : 'video/webm'

interface WebcamCaptureProps {
  token: string
}

function WebcamCapture({ token }: WebcamCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null)

  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadedId, setUploadedId] = useState<string | null>(null)

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
    setRecordedBlob(null)
    setUploadedId(null)
    setUploadError(null)

    const recorder = new MediaRecorder(stream, { mimeType: RECORDING_MIME_TYPE })
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data)
    }
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: RECORDING_MIME_TYPE })
      setRecordedBlob(blob)
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

  const saveToBucket = async () => {
    if (!recordedBlob) return

    setIsUploading(true)
    setUploadError(null)

    try {
      const ext = RECORDING_MIME_TYPE === 'video/mp4' ? 'mp4' : 'webm'
      const formData = new FormData()
      formData.append('video', recordedBlob, `recording.${ext}`)

      const response = await fetch('http://localhost:3001/api/videos', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        setUploadError(data.error ?? 'Upload failed')
        return
      }

      setUploadedId(data.id)
    } catch {
      setUploadError('Could not reach the server')
    } finally {
      setIsUploading(false)
    }
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
          <a href={recordedUrl} download={`recording.${RECORDING_MIME_TYPE === 'video/mp4' ? 'mp4' : 'webm'}`}>
            Download recording
          </a>
          <button type="button" onClick={saveToBucket} disabled={isUploading}>
            {isUploading ? 'Saving…' : 'Save to bucket'}
          </button>
          {uploadedId && <p>Saved (id: {uploadedId})</p>}
          {uploadError && <p role="alert">{uploadError}</p>}
        </div>
      )}
    </section>
  )
}

export default WebcamCapture
