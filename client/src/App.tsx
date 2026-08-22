import { useState } from 'react'
import Login from './Login'
<<<<<<< HEAD
import WebcamCapture from './WebcamCapture'
import Logo from './Logo'
=======
import FormCheck from './FormCheck'
>>>>>>> parent of 1620135 (Revert "Add form-check comparison pipeline (Vision captioning + Pioneer classification)")
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
      <header className="app-header">
        <Logo />
        <button type="button" onClick={handleLogout}>
          Log out
        </button>
      </header>
      <main className="app-main">
        <WebcamCapture token={token} />
      </main>
    </>
  )
}

export default App
