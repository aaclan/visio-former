import { useState } from 'react'

function VideoGenerator({ token }: { token: string }) {
  const [imageUrl, setImageUrl] = useState('')
  const [text, setText] = useState('')
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)

  const generateVideo = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setVideoUrl(null)
    setIsGenerating(true)

    try {
      const response = await fetch('http://localhost:3001/api/videos/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ imageUrl, text, resolution: '720p' }),
      })
      const data = await response.json()

      if (!response.ok) {
        setError(data.error ?? 'Video generation failed')
        return
      }

      setVideoUrl(data.url)
    } catch {
      setError('Could not reach the video server')
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <section id="video-generator">
      <h1>Physio video</h1>
      <form onSubmit={generateVideo}>
        <label>
          Physio image URL
          <input
            type="url"
            value={imageUrl}
            onChange={(event) => setImageUrl(event.target.value)}
            placeholder="https://.../physio.png"
            required
          />
        </label>
        <label>
          What should the video say?
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Explain this shoulder stretch in a friendly tone."
            maxLength={2000}
            required
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={isGenerating}>
          {isGenerating ? 'Generating video...' : 'Generate video'}
        </button>
      </form>
      {videoUrl && (
        <video src={videoUrl} controls width={480} />
      )}
    </section>
  )
}

export default VideoGenerator