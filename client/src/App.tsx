import { useState } from 'react'
import Login from './Login'
import WebcamCapture from './WebcamCapture'
import './App.css'

const TOKEN_STORAGE_KEY = 'auth_token'

function App() {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem(TOKEN_STORAGE_KEY),
  )

  const handleLoginSuccess = (newToken: string) => {
    localStorage.setItem(TOKEN_STORAGE_KEY, newToken)
    setToken(newToken)
  }

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    setToken(null)
  }

  if (!token) {
    return <Login onLoginSuccess={handleLoginSuccess} />
  }

  return (
    <>
      <div className="logout-bar">
        <button type="button" onClick={handleLogout}>
          Log out
        </button>
      </div>
      <WebcamCapture />
    </>
  )
}

export default App
