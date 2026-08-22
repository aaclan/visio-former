import { useEffect, useRef, useState } from 'react'
import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import {
  createPoseLandmarker,
  computeJointAngles,
  drawPoseSkeleton,
  createEmptyJointSamples,
  averageJointSamples,
  compareAverageAngles,
  loadDetachedVideo,
  analyzeVideoAverageAngles,
} from './pose'
import type { JointAngles, JointSamples } from './pose'

const RECORDING_MIME_TYPE = MediaRecorder.isTypeSupported('video/mp4')
  ? 'video/mp4'
  : 'video/webm'

function captureVideoFrameDataUrl(video: HTMLVideoElement): string | null {
  if (video.videoWidth === 0 || video.videoHeight === 0) return null
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.85)
}

interface WebcamCaptureProps {
  token: string
}

function WebcamCapture({ token }: WebcamCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const referenceVideoRef = useRef<HTMLVideoElement>(null)
  const webcamCanvasRef = useRef<HTMLCanvasElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const webcamLandmarkerRef = useRef<PoseLandmarker | null>(null)
  const poseLoopRef = useRef<number | null>(null)
  // Your angles, sampled live while recording.
  const userAngleSamplesRef = useRef<JointSamples>(createEmptyJointSamples())
  // The reference video's angles, averaged once (off-DOM, not in real time) whenever it loads —
  // comparing live frame-by-frame assumed you'd move in lockstep with a pre-rendered video,
  // which never happens, so instead each side's overall average gets compared once at the end.
  const referenceAverageAnglesRef = useRef<Partial<Record<keyof JointAngles, number>>>({})

  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null)

  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadedId, setUploadedId] = useState<string | null>(null)
  const [isComparing, setIsComparing] = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)
  const [compareFeedback, setCompareFeedback] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [isLoadingMedia, setIsLoadingMedia] = useState(false)
  const [referenceVideoUrl, setReferenceVideoUrl] = useState<string | null>(null)
  const [referenceVideoError, setReferenceVideoError] = useState<string | null>(null)
  const [isLoadingReferenceVideo, setIsLoadingReferenceVideo] = useState(false)
  const [poseModelsReady, setPoseModelsReady] = useState(false)
  const [poseError, setPoseError] = useState<string | null>(null)
  const [isAnalyzingReference, setIsAnalyzingReference] = useState(false)
  const [mediapipeFeedback, setMediapipeFeedback] = useState<string | null>(null)
  const [mediapipeCorrect, setMediapipeCorrect] = useState<boolean | null>(null)
  const [isMediapipeVeedGenerating, setIsMediapipeVeedGenerating] = useState(false)
  const [mediapipeVeedUrl, setMediapipeVeedUrl] = useState<string | null>(null)
  const [mediapipeVeedError, setMediapipeVeedError] = useState<string | null>(null)

  useEffect(() => {
    if (!submitted) return

    let active = true
    setIsLoadingMedia(true)

    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((mediaStream) => {
        if (!active) {
          mediaStream.getTracks().forEach((track) => track.stop())
          return
        }
        setStream(mediaStream)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Could not access webcam')
      })
      .finally(() => {
        if (active) setIsLoadingMedia(false)
      })

    return () => {
      active = false
      stream?.getTracks().forEach((track) => track.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted])

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
      void videoRef.current.play().catch(() => {})
    }
  }, [stream, isLoadingMedia])

  useEffect(() => {
    if (!submitted) return

    let active = true
    createPoseLandmarker()
      .then((landmarker) => {
        if (!active) {
          landmarker.close()
          return
        }
        webcamLandmarkerRef.current = landmarker
        setPoseModelsReady(true)
      })
      .catch((err: unknown) => {
        setPoseError(err instanceof Error ? err.message : 'Could not load the pose model')
      })

    return () => {
      active = false
      if (poseLoopRef.current !== null) {
        cancelAnimationFrame(poseLoopRef.current)
        poseLoopRef.current = null
      }
      webcamLandmarkerRef.current?.close()
      webcamLandmarkerRef.current = null
      setPoseModelsReady(false)
    }
  }, [submitted])

  useEffect(() => {
    return () => {
      if (recordedUrl) URL.revokeObjectURL(recordedUrl)
    }
  }, [recordedUrl])

  useEffect(() => {
    return () => {
      if (referenceVideoUrl) URL.revokeObjectURL(referenceVideoUrl)
    }
  }, [referenceVideoUrl])

  // Only tracks your own angles live — the reference side is analyzed once, separately (see
  // analyzeReferenceVideo), since comparing frame-by-frame in real time assumed you'd move in
  // lockstep with a pre-rendered video, which realistically never happens.
  const startPoseTrackingLoop = () => {
    const step = () => {
      const webcamLandmarker = webcamLandmarkerRef.current
      const webcamVideo = videoRef.current

      if (webcamLandmarker && webcamVideo && webcamVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const landmarks = webcamLandmarker.detectForVideo(webcamVideo, performance.now()).landmarks[0]

        const webcamCanvas = webcamCanvasRef.current
        if (webcamCanvas && landmarks) {
          const ctx = webcamCanvas.getContext('2d')
          if (ctx) drawPoseSkeleton(ctx, landmarks, webcamCanvas.width, webcamCanvas.height)
        }

        const angles = landmarks ? computeJointAngles(landmarks) : null
        if (angles) {
          for (const joint of Object.keys(angles) as (keyof JointAngles)[]) {
            userAngleSamplesRef.current[joint].push(angles[joint])
          }
        }
      }

      poseLoopRef.current = requestAnimationFrame(step)
    }
    poseLoopRef.current = requestAnimationFrame(step)
  }

  const stopPoseTrackingLoop = () => {
    if (poseLoopRef.current !== null) {
      cancelAnimationFrame(poseLoopRef.current)
      poseLoopRef.current = null
    }
  }

  /** Samples the reference video once, off-DOM, right when it loads — not tied to recording at all. */
  const analyzeReferenceVideo = async (videoUrl: string) => {
    setIsAnalyzingReference(true)
    try {
      const detachedVideo = await loadDetachedVideo(videoUrl)
      const landmarker = await createPoseLandmarker()
      try {
        referenceAverageAnglesRef.current = await analyzeVideoAverageAngles(detachedVideo, landmarker)
      } finally {
        landmarker.close()
      }
    } catch (err) {
      setPoseError(err instanceof Error ? err.message : 'Could not analyze the reference video')
    } finally {
      setIsAnalyzingReference(false)
    }
  }

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
    setCompareFeedback(null)
    setCompareError(null)
    setMediapipeFeedback(null)
    setMediapipeCorrect(null)
    setMediapipeVeedUrl(null)
    setMediapipeVeedError(null)
    userAngleSamplesRef.current = createEmptyJointSamples()

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

    // Purely a visual aid to follow along now — no longer analyzed live.
    void referenceVideoRef.current?.play().catch(() => {})
    if (poseModelsReady) startPoseTrackingLoop()
  }

  const generateMediapipeVeed = async (feedback: string) => {
    const imageDataUrl = referenceVideoRef.current
      ? captureVideoFrameDataUrl(referenceVideoRef.current)
      : null

    if (!imageDataUrl) {
      setMediapipeVeedError('Could not capture a reference image')
      return
    }

    setIsMediapipeVeedGenerating(true)
    setMediapipeVeedError(null)

    try {
      const response = await fetch(
        `http://localhost:3001/api/mediapipe-veed/${encodeURIComponent(description.trim())}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ feedback, imageDataUrl }),
        },
      )

      const data = await response.json()

      if (!response.ok) {
        setMediapipeVeedError(data.error ?? 'Could not generate the advice video')
        return
      }

      setMediapipeVeedUrl(data.veedVideoUrl)
    } catch {
      setMediapipeVeedError('Could not reach the server')
    } finally {
      setIsMediapipeVeedGenerating(false)
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    setIsRecording(false)
    stopPoseTrackingLoop()
    referenceVideoRef.current?.pause()

    // Shown immediately (pure client-side math); the VEED video generation kicked off right
    // after is much slower, so it's deliberately not awaited here — the text feedback below
    // doesn't wait on it. Compares this session's overall average angles against the
    // reference's overall average (computed once when it loaded), not paired per-frame.
    const userAverages = averageJointSamples(userAngleSamplesRef.current)
    const summary = compareAverageAngles(userAverages, referenceAverageAnglesRef.current)
    setMediapipeFeedback(summary.feedback)
    setMediapipeCorrect(summary.overallCorrect)

    void generateMediapipeVeed(summary.feedback)
  }

  const startSession = async () => {
    if (!description.trim()) return

    setSubmitted(true)
    setReferenceVideoError(null)
    setReferenceVideoUrl(null)
    setIsLoadingReferenceVideo(true)

    try {
      const generateResponse = await fetch('http://localhost:3001/api/exercises/generate', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ exercise: description.trim() }),
      })

      if (!generateResponse.ok) {
        const data = await generateResponse.json()
        setReferenceVideoError(data.error ?? 'Could not generate the reference video')
        return
      }

      // Fetched as an authenticated blob (not the GCS signed URL directly) so the resulting
      // blob: URL isn't cross-origin — MediaPipe can then read its pixel data freely, which
      // it couldn't from the GCS URL since that bucket has no CORS policy configured.
      const videoResponse = await fetch(
        `http://localhost:3001/api/exercises/${encodeURIComponent(description.trim())}/video`,
        { headers: { Authorization: `Bearer ${token}` } },
      )

      if (!videoResponse.ok) {
        setReferenceVideoError('Could not load the reference video')
        return
      }

      const blob = await videoResponse.blob()
      const url = URL.createObjectURL(blob)
      setReferenceVideoUrl(url)
      void analyzeReferenceVideo(url)
    } catch {
      setReferenceVideoError('Could not reach the server')
    } finally {
      setIsLoadingReferenceVideo(false)
    }
  }

  const resetToDescription = () => {
    mediaRecorderRef.current?.stop()
    stream?.getTracks().forEach((track) => track.stop())
    if (recordedUrl) URL.revokeObjectURL(recordedUrl)
    if (referenceVideoUrl) URL.revokeObjectURL(referenceVideoUrl)
    stopPoseTrackingLoop()

    setStream(null)
    setIsRecording(false)
    setRecordedBlob(null)
    setRecordedUrl(null)
    setUploadedId(null)
    setUploadError(null)
    setCompareFeedback(null)
    setCompareError(null)
    setReferenceVideoUrl(null)
    setReferenceVideoError(null)
    setPoseError(null)
    setIsAnalyzingReference(false)
    setMediapipeFeedback(null)
    setMediapipeCorrect(null)
    setMediapipeVeedUrl(null)
    setMediapipeVeedError(null)
    setSubmitted(false)
  }

  const runCompare = async () => {
    setIsComparing(true)
    setCompareError(null)
    setCompareFeedback(null)

    try {
      const response = await fetch(
        `http://localhost:3001/api/compare/${encodeURIComponent(description.trim())}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        },
      )

      const data = await response.json()

      if (!response.ok) {
        setCompareError(data.error ?? 'Could not compare your form')
        return
      }

      setCompareFeedback(data.feedback)
    } catch {
      setCompareError('Could not reach the server')
    } finally {
      setIsComparing(false)
    }
  }

  const saveToBucket = async () => {
    if (!recordedBlob) return

    setIsUploading(true)
    setUploadError(null)
    setCompareFeedback(null)
    setCompareError(null)

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
      await runCompare()
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
      <h1>Visio Former</h1>

      <div className="exercise-description">
        {/* <label htmlFor="exercise-description-input"></label> */}
        <div className="exercise-description-row">
          <textarea
            id="exercise-description-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the exercise video you want to follow"
            rows={3}
            disabled={submitted}
          />
          {!submitted ? (
            <button
              type="button"
              onClick={startSession}
              disabled={!description.trim()}
            >
              Let's do it!
            </button>
          ) : (
            <button type="button" onClick={resetToDescription}>
              Let's do another one!
            </button>
          )}
        </div>
      </div>

      {submitted && isLoadingMedia && <p>Loading…</p>}

      {submitted && !isLoadingMedia && (
        <>
          <div className="capture-layout">
            <div className="reference-column">
              <h2>Reference video</h2>
              {isLoadingReferenceVideo ? (
                <div className="reference-video-placeholder">
                  <p>Generating your reference video — this takes a minute or two…</p>
                </div>
              ) : referenceVideoUrl ? (
                <>
                  <video
                    ref={referenceVideoRef}
                    src={referenceVideoUrl}
                    controls
                    loop
                    muted
                    playsInline
                    width={480}
                    height={360}
                  />
                  {isAnalyzingReference && (
                    <p className="compare-status">Analyzing the reference video's form…</p>
                  )}
                </>
              ) : (
                <div className="reference-video-placeholder">
                  <p role={referenceVideoError ? 'alert' : undefined}>
                    {referenceVideoError ?? 'No reference video yet'}
                  </p>
                </div>
              )}
            </div>

            <div className="capture-column">
              <h2>Webcam</h2>
              <div className="video-with-overlay">
                <video ref={videoRef} autoPlay muted playsInline width={480} height={360} />
                <canvas ref={webcamCanvasRef} className="pose-overlay-canvas" width={480} height={360} />
              </div>

              <div className="webcam-controls">
                {!isRecording ? (
                  <button
                    type="button"
                    onClick={startRecording}
                    disabled={!stream || !poseModelsReady || isAnalyzingReference}
                  >
                    Start recording
                  </button>
                ) : (
                  <button type="button" onClick={stopRecording}>
                    Stop recording
                  </button>
                )}
              </div>
              {!poseModelsReady && !poseError && <p className="compare-status">Loading live pose model…</p>}
              {poseError && <p role="alert">{poseError}</p>}
            </div>
          </div>

          {mediapipeFeedback && (
            <div className={`mediapipe-feedback ${mediapipeCorrect ? 'is-correct' : 'is-incorrect'}`}>
              <h3>{mediapipeCorrect ? '✓ Looking good!' : '✗ Needs adjustment'}</h3>
              <p>{mediapipeFeedback}</p>

              {isMediapipeVeedGenerating && (
                <p className="compare-status">Generating your advice video with VEED…</p>
              )}
              {mediapipeVeedUrl && (
                <video src={mediapipeVeedUrl} controls width={480} height={360} />
              )}
              {mediapipeVeedError && <p role="alert">{mediapipeVeedError}</p>}
            </div>
          )}
        </>
      )}

      {recordedUrl && (
        <div className="webcam-playback">
          <h2>Recording</h2>
          <video src={recordedUrl} controls width={480} height={360} />
          <a href={recordedUrl} download={`recording.${RECORDING_MIME_TYPE === 'video/mp4' ? 'mp4' : 'webm'}`}>
            Download recording
          </a>
          <button type="button" onClick={saveToBucket} disabled={isUploading || isComparing}>
            {isUploading ? 'Saving…' : isComparing ? 'Comparing…' : 'Am I doing it right?'}
          </button>
          {uploadedId && <p>Saved (id: {uploadedId})</p>}
          {uploadError && <p role="alert">{uploadError}</p>}

          {isComparing && <p className="compare-status">Comparing your form against the reference…</p>}
          {compareFeedback && (
            <div className="compare-feedback">
              <h3>Feedback</h3>
              <p>{compareFeedback}</p>
            </div>
          )}
          {compareError && <p role="alert">{compareError}</p>}
        </div>
      )}
    </section>
  )
}

export default WebcamCapture
