import { useState } from 'react'
import type { FormEvent } from 'react'
import { GoogleLogin } from '@react-oauth/google'

interface LoginProps {
  onLoginSuccess: (token: string) => void
}

function Login({ onLoginSuccess }: LoginProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      const response = await fetch('http://localhost:3001/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error ?? 'Login failed')
        return
      }

      onLoginSuccess(data.token)
    } catch {
      setError('Could not reach the server')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleGoogleSuccess = async (credential: string) => {
    setError(null)

    try {
      const response = await fetch('http://localhost:3001/api/login/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error ?? 'Google login failed')
        return
      }

      onLoginSuccess(data.token)
    } catch {
      setError('Could not reach the server')
    }
  }

  return (
    <section id="login">
      <h1>Log in</h1>
      <form onSubmit={handleSubmit}>
        <label>
          Username
          <input
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>

      <div className="login-divider">or</div>

      <GoogleLogin
        onSuccess={(response) => {
          if (response.credential) {
            void handleGoogleSuccess(response.credential)
          }
        }}
        onError={() => setError('Google login failed')}
      />
    </section>
  )
}

export default Login
