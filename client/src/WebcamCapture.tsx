import { useEffect, useRef, useState } from 'react'
import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import { createPoseLandmarker, computeJointAngles, JOINT_LABELS } from './pose'
import type { JointAngles } from './pose'

const RECORDING_MIME_TYPE = MediaRecorder.isTypeSupported('video/mp4')
  ? 'video/mp4'
  : 'video/webm'

interface WebcamCaptureProps {
  token: string
}

interface JointDelta {
  user: number
  reference: number
  delta: number
}

function WebcamCapture({ token }: WebcamCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const referenceVideoRef = useRef<HTMLVideoElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  // Each video feed needs its own PoseLandmarker instance: detectForVideo() requires
  // strictly increasing timestamps per instance, and the webcam/reference feeds run on
  // independent timelines.
  const webcamLandmarkerRef = useRef<PoseLandmarker | null>(null)
  const referenceLandmarkerRef = useRef<PoseLandmarker | null>(null)
  const poseLoopRef = useRef<number | null>(null)

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
  const [liveAngleDeltas, setLiveAngleDeltas] = useState<Record<keyof JointAngles, JointDelta> | null>(null)

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
    Promise.all([createPoseLandmarker(), createPoseLandmarker()])
      .then(([webcamLandmarker, referenceLandmarker]) => {
        if (!active) {
          webcamLandmarker.close()
          referenceLandmarker.close()
          return
        }
        webcamLandmarkerRef.current = webcamLandmarker
        referenceLandmarkerRef.current = referenceLandmarker
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
      referenceLandmarkerRef.current?.close()
      webcamLandmarkerRef.current = null
      referenceLandmarkerRef.current = null
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

  const startPoseComparisonLoop = () => {
    const step = () => {
      const webcamLandmarker = webcamLandmarkerRef.current
      const referenceLandmarker = referenceLandmarkerRef.current
      const webcamVideo = videoRef.current
      const referenceVideo = referenceVideoRef.current

      if (
        webcamLandmarker &&
        referenceLandmarker &&
        webcamVideo &&
        referenceVideo &&
        !referenceVideo.paused &&
        referenceVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        const now = performance.now()
        const userLandmarks = webcamLandmarker.detectForVideo(webcamVideo, now).landmarks[0]
        const referenceLandmarks = referenceLandmarker.detectForVideo(referenceVideo, now).landmarks[0]

        const userAngles = userLandmarks ? computeJointAngles(userLandmarks) : null
        const referenceAngles = referenceLandmarks ? computeJointAngles(referenceLandmarks) : null

        if (userAngles && referenceAngles) {
          const deltas = {} as Record<keyof JointAngles, JointDelta>
          for (const joint of Object.keys(userAngles) as (keyof JointAngles)[]) {
            deltas[joint] = {
              user: userAngles[joint],
              reference: referenceAngles[joint],
              delta: userAngles[joint] - referenceAngles[joint],
            }
          }
          setLiveAngleDeltas(deltas)
        }
      }

      poseLoopRef.current = requestAnimationFrame(step)
    }
    poseLoopRef.current = requestAnimationFrame(step)
  }

  const stopPoseComparisonLoop = () => {
    if (poseLoopRef.current !== null) {
      cancelAnimationFrame(poseLoopRef.current)
      poseLoopRef.current = null
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
    setLiveAngleDeltas(null)

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

    if (poseModelsReady) {
      void referenceVideoRef.current?.play().catch(() => {})
      startPoseComparisonLoop()
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    setIsRecording(false)
    stopPoseComparisonLoop()
    referenceVideoRef.current?.pause()
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
      setReferenceVideoUrl(URL.createObjectURL(blob))
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
    stopPoseComparisonLoop()

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
    setLiveAngleDeltas(null)
    setPoseError(null)
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
              {!poseModelsReady && !poseError && <p className="compare-status">Loading live pose model…</p>}
              {poseError && <p role="alert">{poseError}</p>}
            </div>
          </div>

          {isRecording && (
            <div className="live-pose-feedback">
              <h3>Live joint comparison (MediaPipe)</h3>
              {liveAngleDeltas ? (
                <ul>
                  {(Object.keys(liveAngleDeltas) as (keyof JointAngles)[]).map((joint) => {
                    const d = liveAngleDeltas[joint]
                    return (
                      <li key={joint}>
                        {JOINT_LABELS[joint]}: {d.user.toFixed(0)}° (you) vs {d.reference.toFixed(0)}° (reference) —{' '}
                        <strong>{Math.abs(d.delta).toFixed(0)}° off</strong>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p>Waiting for a clear view of both videos…</p>
              )}
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
