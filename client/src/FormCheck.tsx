import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'

const REFERENCE_VIDEO_SRC = 'http://localhost:3001/reference-video.mp4'

function FormCheck() {
  const [userFile, setUserFile] = useState<File | null>(null)
  const [userVideoUrl, setUserVideoUrl] = useState<string | null>(null)
  const [isComparing, setIsComparing] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      if (userVideoUrl) URL.revokeObjectURL(userVideoUrl)
    }
  }, [userVideoUrl])

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    setFeedback(null)
    setError(null)
    if (userVideoUrl) URL.revokeObjectURL(userVideoUrl)
    setUserFile(file)
    setUserVideoUrl(file ? URL.createObjectURL(file) : null)
  }

  const handleCompare = async () => {
    if (!userFile) return

    setIsComparing(true)
    setError(null)
    setFeedback(null)

    try {
      const formData = new FormData()
      formData.append('video', userFile)

      const response = await fetch('http://localhost:3001/api/compare', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error ?? 'Comparison failed')
        return
      }

      setFeedback(data.feedback)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not compare videos')
    } finally {
      setIsComparing(false)
    }
  }

  return (
    <section id="form-check">
      <h1>Form Check</h1>

      <div className="form-check-videos">
        <div className="form-check-video">
          <h2>Reference</h2>
          <video src={REFERENCE_VIDEO_SRC} controls width={360} height={270} />
        </div>

        <div className="form-check-video">
          <h2>Your attempt</h2>
          <input type="file" accept="video/*" onChange={handleFileChange} />
          {userVideoUrl && <video src={userVideoUrl} controls width={360} height={270} />}
        </div>
      </div>

      <button type="button" onClick={() => void handleCompare()} disabled={!userFile || isComparing}>
        {isComparing ? 'Comparing…' : 'Compare form'}
      </button>

      {error && <p role="alert">{error}</p>}

      {feedback && (
        <div className="form-check-feedback">
          <h2>Feedback</h2>
          <p>{feedback}</p>
        </div>
      )}
    </section>
  )
}

export default FormCheck
