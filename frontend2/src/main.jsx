import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import './index.css'
import App from './App'
import it from './locales/it/translation.json'
import en from './locales/en/translation.json'

i18n.use(initReactI18next).init({
  resources: {
    it: { translation: it },
    en: { translation: en },
  },
  lng: localStorage.getItem('iqframe_lang') || 'it',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
