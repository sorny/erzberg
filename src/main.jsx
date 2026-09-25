import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { applyTheme, storedTheme } from './utils/theme'

// Before the first render, so a light-mode visit never flashes dark.
applyTheme(storedTheme())

createRoot(document.getElementById('root')).render(<App />)
