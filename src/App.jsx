import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Download, Hand, ImagePlus, Maximize2, Moon, RotateCcw, Sun, Upload, X, ZoomIn, ZoomOut } from 'lucide-react'
import { languages, translations } from './translations.js'
import './App.css'

const defaultObservations = {
  centering: 10,
  corners: 10,
  edges: 10,
  surface: 10,
}

const supportedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const maximumFreeUploads = 3
const uploadCountStorageKey = 'sticker-check-upload-count'
const uploadLockStorageKey = 'sticker-check-upload-locked'
const uploadUnlockedStorageKey = 'sticker-check-upload-unlocked'
const maxAnalysisDimension = 2048
const minimumCropSize = 0.03
const minimumImageZoom = 0.5
const maximumImageZoom = 3
const imageZoomStep = 0.25

const pointOnImage = (event, image) => {
  const bounds = image.getBoundingClientRect()
  return {
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
  }
}

const cropBetween = (start, end) => ({
  x: Math.min(start.x, end.x),
  y: Math.min(start.y, end.y),
  width: Math.abs(end.x - start.x),
  height: Math.abs(end.y - start.y),
})

const criteria = [
  { id: 'centering', values: [10, 9, 8, 6] },
  { id: 'corners', values: [10, 9, 8, 6] },
  { id: 'edges', values: [10, 9, 8, 6] },
  { id: 'surface', values: [10, 9, 8, 6] },
]

const gradeLabel = (score, t) => {
  if (score >= 9.5) return t.gemMint
  if (score >= 8.5) return t.nearMintMint
  if (score >= 7.5) return t.nearMint
  if (score >= 6.5) return t.excellent
  return t.closerReview
}

const drawWrappedText = (context, text, x, y, maxWidth, lineHeight, maxLines) => {
  const words = text.split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  let wordIndex = 0

  for (; wordIndex < words.length; wordIndex += 1) {
    const word = words[wordIndex]
    const candidate = line ? `${line} ${word}` : word
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line)
      line = word
      if (lines.length === maxLines) {
        wordIndex += 1
        break
      }
    } else {
      line = candidate
    }
  }

  if (line && lines.length < maxLines) lines.push(line)
  if (wordIndex < words.length && lines.length) {
    let lastLine = lines[lines.length - 1]
    while (lastLine && context.measureText(`${lastLine}…`).width > maxWidth) {
      lastLine = lastLine.slice(0, -1)
    }
    lines[lines.length - 1] = `${lastLine}…`
  }

  lines.forEach((textLine, index) => context.fillText(textLine, x, y + index * lineHeight))
}

function App() {
  const [language, setLanguage] = useState(() => {
    const savedLanguage = window.localStorage.getItem('sticker-check-language')
    return languages.includes(savedLanguage) ? savedLanguage : 'en'
  })
  const [theme, setTheme] = useState(() => (
    window.localStorage.getItem('sticker-check-theme') === 'light' ? 'light' : 'dark'
  ))
  const [uploadCount, setUploadCount] = useState(() => {
    const storedCount = Number(window.localStorage.getItem(uploadCountStorageKey))
    return Number.isFinite(storedCount) ? Math.max(0, storedCount) : 0
  })
  const [isUploadLocked, setIsUploadLocked] = useState(() => (
    window.localStorage.getItem(uploadLockStorageKey) === 'true'
      && window.localStorage.getItem(uploadUnlockedStorageKey) !== 'true'
  ))
  const [isUploadUnlocked, setIsUploadUnlocked] = useState(() => (
    window.localStorage.getItem(uploadUnlockedStorageKey) === 'true'
  ))
  const [photos, setPhotos] = useState([])
  const isAnalyzing = photos.some((photo) => photo.status === 'analyzing')
  const [activePhoto, setActivePhoto] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [uploadMessage, setUploadMessage] = useState('')
  const [exportMessage, setExportMessage] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const [cropDraft, setCropDraft] = useState(null)
  const [imageZoom, setImageZoom] = useState(1)
  const [imagePan, setImagePan] = useState({ x: 0, y: 0 })
  const [isPanMode, setIsPanMode] = useState(false)
  const [isDonationDialogOpen, setIsDonationDialogOpen] = useState(false)
  const [isUnlockDialogOpen, setIsUnlockDialogOpen] = useState(() => (
    window.localStorage.getItem(uploadLockStorageKey) === 'true'
  ))
  const [unlockKey, setUnlockKey] = useState('')
  const [unlockMessage, setUnlockMessage] = useState('')
  const [isVerifyingUnlockKey, setIsVerifyingUnlockKey] = useState(false)
  const inputRef = useRef(null)
  const cropDragRef = useRef(null)
  const panDragRef = useRef(null)
  const objectUrls = useRef(new Set())
  const uploadCountRef = useRef(uploadCount)
  const t = translations[language]

  useEffect(() => () => objectUrls.current.forEach((url) => URL.revokeObjectURL(url)), [])

  const resetImageView = () => {
    setImageZoom(1)
    setImagePan({ x: 0, y: 0 })
    setIsPanMode(false)
    setCropDraft(null)
    cropDragRef.current = null
    panDragRef.current = null
  }

  useEffect(() => {
    document.documentElement.lang = language
    window.localStorage.setItem('sticker-check-language', language)
  }, [language])

  useEffect(() => {
    window.localStorage.setItem('sticker-check-theme', theme)
  }, [theme])

  const evaluatePhoto = async (photo) => {
    setUploadMessage('')
    setPhotos((current) => current.map((item) => (
      item.id === photo.id ? { ...item, status: 'analyzing', error: null } : item
    )))

    try {
      const bitmap = await createImageBitmap(photo.file)
      let imageData
      try {
        const crop = photo.crop ?? { x: 0, y: 0, width: 1, height: 1 }
        const sourceX = Math.min(bitmap.width - 1, Math.round(crop.x * bitmap.width))
        const sourceY = Math.min(bitmap.height - 1, Math.round(crop.y * bitmap.height))
        const sourceWidth = Math.min(bitmap.width - sourceX, Math.max(1, Math.round(crop.width * bitmap.width)))
        const sourceHeight = Math.min(bitmap.height - sourceY, Math.max(1, Math.round(crop.height * bitmap.height)))
        const scale = Math.min(1, maxAnalysisDimension / Math.max(sourceWidth, sourceHeight))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(sourceWidth * scale))
        canvas.height = Math.max(1, Math.round(sourceHeight * scale))
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Could not prepare the image for local analysis.')
        context.fillStyle = '#fff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(
          bitmap,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          canvas.width,
          canvas.height,
        )
        imageData = canvas.toDataURL('image/jpeg', 0.9)
      } finally {
        bitmap.close()
      }

      const response = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageData, language }),
      })
      let result
      try {
        result = await response.json()
      } catch {
        throw new Error('The evaluation service returned an unreadable response.')
      }
      if (!response.ok) throw new Error(result.error || 'Photo evaluation failed.')

      setPhotos((current) => current.map((item) => (
        item.id === photo.id
          ? { ...item, status: 'ready', evaluation: result, observations: result.scores, error: null }
          : item
      )))
    } catch (error) {
      setPhotos((current) => current.map((item) => (
        item.id === photo.id
          ? { ...item, status: 'error', error: error.message || 'Photo evaluation failed.' }
          : item
      )))
    }
  }

  const addPhotos = (files) => {
    if (isUploadLocked) {
      setIsUnlockDialogOpen(true)
      return
    }
    if (isAnalyzing) {
      setUploadMessage(translations[language].waitForAnalysis)
      return
    }
    const selectedFiles = Array.from(files)
    if (!selectedFiles.length) return
    if (selectedFiles.some((file) => !supportedImageTypes.has(file.type) || file.size > 8 * 1024 * 1024)) {
      setUploadMessage(translations[language].invalidUpload)
      return
    }

    setUploadMessage('')
    const availableSlots = isUploadUnlocked
      ? selectedFiles.length
      : Math.max(0, maximumFreeUploads - uploadCountRef.current)
    const filesToAdd = selectedFiles.slice(0, availableSlots)
    const addedPhotos = filesToAdd.map((file) => {
      const url = URL.createObjectURL(file)
      objectUrls.current.add(url)
      return {
        id: crypto.randomUUID(),
        name: file.name,
        url,
        file,
        status: 'pending',
        crop: null,
        observations: defaultObservations,
        evaluation: null,
        error: null,
      }
    })
    if (!addedPhotos.length) {
      window.localStorage.setItem(uploadLockStorageKey, 'true')
      setIsUploadLocked(true)
      setIsUnlockDialogOpen(true)
      return
    }
    setActivePhoto(photos.length + addedPhotos.length - 1)
    resetImageView()
    setPhotos((current) => [...current, ...addedPhotos])
    const nextUploadCount = uploadCountRef.current + addedPhotos.length
    uploadCountRef.current = nextUploadCount
    setUploadCount(nextUploadCount)
    window.localStorage.setItem(uploadCountStorageKey, String(nextUploadCount))
    if (nextUploadCount > 1) setIsDonationDialogOpen(true)
    if (!isUploadUnlocked && selectedFiles.length > availableSlots) {
      window.localStorage.setItem(uploadLockStorageKey, 'true')
      setIsUploadLocked(true)
      setIsUnlockDialogOpen(true)
    }
  }

  const removePhoto = (id) => {
    if (isAnalyzing) return
    const photo = photos.find((item) => item.id === id)
    if (photo) {
      URL.revokeObjectURL(photo.url)
      objectUrls.current.delete(photo.url)
    }
    const nextPhotos = photos.filter((item) => item.id !== id)
    setPhotos(nextPhotos)
    setActivePhoto(Math.max(0, Math.min(activePhoto, nextPhotos.length - 1)))
    resetImageView()
  }

  const currentPhoto = photos[activePhoto]
  const observations = currentPhoto?.observations ?? defaultObservations
  const score = currentPhoto?.status === 'ready' && currentPhoto.evaluation?.isSticker
    ? Number((Object.values(observations).reduce((total, value) => total + value, 0) / criteria.length).toFixed(1))
    : null

  const exportResults = async () => {
    if (currentPhoto?.status !== 'ready') return

    setExportMessage('')
    setIsExporting(true)
    try {
      const image = new Image()
      await new Promise((resolve, reject) => {
        image.onload = resolve
        image.onerror = () => reject(new Error('Could not load the analyzed photo.'))
        image.src = currentPhoto.url
      })

      const canvas = document.createElement('canvas')
      canvas.width = 1200
      canvas.height = 1500
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Could not prepare the result image.')

      context.fillStyle = '#f4f5f0'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = '#1e4032'
      context.fillRect(0, 0, canvas.width, 150)
      context.fillStyle = '#f2a087'
      context.font = '600 22px "DM Mono", monospace'
      context.fillText('S/C', 80, 66)
      context.fillStyle = '#e3ebe4'
      context.font = '500 16px "DM Sans", sans-serif'
      context.fillText('STICKER CHECK', 140, 64)
      context.fillStyle = '#ffffff'
      context.font = '500 34px "Playfair Display", Georgia, serif'
      context.fillText(t.exportTitle, 80, 116)

      const photoBox = { x: 80, y: 190, width: 1040, height: 510 }
      context.fillStyle = '#e4e9e4'
      context.fillRect(photoBox.x, photoBox.y, photoBox.width, photoBox.height)
      const crop = currentPhoto.crop ?? { x: 0, y: 0, width: 1, height: 1 }
      const sourceX = Math.min(image.naturalWidth - 1, Math.round(crop.x * image.naturalWidth))
      const sourceY = Math.min(image.naturalHeight - 1, Math.round(crop.y * image.naturalHeight))
      const sourceWidth = Math.max(1, Math.min(image.naturalWidth - sourceX, Math.round(crop.width * image.naturalWidth)))
      const sourceHeight = Math.max(1, Math.min(image.naturalHeight - sourceY, Math.round(crop.height * image.naturalHeight)))
      const imageScale = Math.min(photoBox.width / sourceWidth, photoBox.height / sourceHeight)
      const imageWidth = sourceWidth * imageScale
      const imageHeight = sourceHeight * imageScale
      context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        photoBox.x + (photoBox.width - imageWidth) / 2,
        photoBox.y + (photoBox.height - imageHeight) / 2,
        imageWidth,
        imageHeight,
      )
      context.strokeStyle = '#d7ded7'
      context.lineWidth = 2
      context.strokeRect(photoBox.x, photoBox.y, photoBox.width, photoBox.height)

      context.fillStyle = '#52645a'
      context.font = '500 15px "DM Mono", monospace'
      context.fillText(t.estimate, 80, 765)
      context.fillStyle = '#202a25'
      context.font = '500 104px "Playfair Display", Georgia, serif'
      const scoreText = score === null ? '—' : String(score)
      context.fillText(scoreText, 80, 880)
      const scoreWidth = context.measureText(scoreText).width
      context.fillStyle = '#78837c'
      context.font = '500 22px "DM Mono", monospace'
      context.fillText(score === null ? t.noGrade : '/ 10', 96 + scoreWidth, 878)
      context.fillStyle = '#a64f3a'
      context.font = '500 25px "Playfair Display", Georgia, serif'
      context.fillText(score === null ? t.stickerUnconfirmed : gradeLabel(score, t), 80, 928)
      context.fillStyle = '#65746b'
      context.font = '400 15px "DM Sans", sans-serif'
      context.fillText(score === null ? t.stickerVisibility : t.unofficialEstimate, 80, 960)

      context.fillStyle = '#52645a'
      context.font = '500 15px "DM Mono", monospace'
      context.fillText(t.areaBreakdown, 590, 765)
      criteria.forEach((criterion, index) => {
        const rowY = 820 + index * 62
        const value = observations[criterion.id]
        context.fillStyle = '#202a25'
        context.font = '500 19px "DM Sans", sans-serif'
        context.fillText(t.criteria[criterion.id].name, 590, rowY)
        context.textAlign = 'right'
        context.font = '500 18px "DM Mono", monospace'
        context.fillText(score === null ? '—' : String(value), 1120, rowY)
        context.textAlign = 'left'
        context.fillStyle = '#dce3dc'
        context.fillRect(590, rowY + 13, 490, 5)
        context.fillStyle = '#d7654b'
        context.fillRect(590, rowY + 13, score === null ? 0 : 490 * (value / 10), 5)
      })

      context.strokeStyle = '#dce2dc'
      context.beginPath()
      context.moveTo(80, 1085)
      context.lineTo(1120, 1085)
      context.stroke()
      context.fillStyle = '#52645a'
      context.font = '500 15px "DM Mono", monospace'
      context.fillText(t.analysisNotes, 80, 1130)
      context.fillStyle = '#39483f'
      context.font = '400 20px "DM Sans", sans-serif'
      drawWrappedText(context, currentPhoto.evaluation.summary, 80, 1175, 1040, 32, 4)

      context.fillStyle = '#78837c'
      context.font = '400 15px "DM Sans", sans-serif'
      drawWrappedText(context, t.limitations, 80, 1360, 1040, 21, 2)
      context.fillStyle = '#52645a'
      context.font = '500 13px "DM Mono", monospace'
      context.fillText(`STICKER CHECK  /  ${t.footerTool}`, 80, 1440)

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((result) => {
          if (result) resolve(result)
          else reject(new Error('Could not encode the result image.'))
        }, 'image/png')
      })
      const downloadUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = `${currentPhoto.name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-')}-analysis.png`
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
    } catch (error) {
      console.error('Could not export the analysis result image.', error)
      setExportMessage(t.exportError)
    } finally {
      setIsExporting(false)
    }
  }

  const changePhoto = (direction) => {
    setActivePhoto((current) => (current + direction + photos.length) % photos.length)
    resetImageView()
  }

  const updateCropDraft = (event) => {
    const panDrag = panDragRef.current
    if (panDrag && panDrag.pointerId === event.pointerId) {
      const stage = event.currentTarget.getBoundingClientRect()
      const image = event.currentTarget.querySelector('.crop-image-wrap')
      if (!image) return
      const bounds = panDrag.bounds
      const deltaX = event.clientX - panDrag.startX
      const deltaY = event.clientY - panDrag.startY
      const minX = stage.left + 16 - bounds.right
      const maxX = stage.right - 16 - bounds.left
      const minY = stage.top + 16 - bounds.bottom
      const maxY = stage.bottom - 16 - bounds.top
      setImagePan({
        x: panDrag.pan.x + Math.max(minX, Math.min(maxX, deltaX)),
        y: panDrag.pan.y + Math.max(minY, Math.min(maxY, deltaY)),
      })
      return
    }
    const drag = cropDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const image = event.currentTarget.querySelector('.crop-image-wrap img')
    if (image) setCropDraft(cropBetween(drag.start, pointOnImage(event, image)))
  }

  const startCropSelection = (event) => {
    if (currentPhoto?.status !== 'pending' || event.button !== 0 || !event.target.closest('.crop-image-wrap')) return
    event.preventDefault()
    if (isPanMode) {
      const image = event.currentTarget.querySelector('.crop-image-wrap')
      if (!image) return
      panDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        pan: imagePan,
        bounds: image.getBoundingClientRect(),
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    const image = event.currentTarget.querySelector('.crop-image-wrap img')
    if (!image) return
    const start = pointOnImage(event, image)
    cropDragRef.current = {
      pointerId: event.pointerId,
      start,
      pointerStartX: event.clientX,
      pointerStartY: event.clientY,
    }
    setCropDraft({ x: start.x, y: start.y, width: 0, height: 0 })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const finishCropSelection = (event) => {
    const panDrag = panDragRef.current
    if (panDrag && panDrag.pointerId === event.pointerId) {
      panDragRef.current = null
      if (Math.hypot(event.clientX - panDrag.startX, event.clientY - panDrag.startY) < 5) {
        setIsPanMode((current) => !current)
      }
      return
    }
    const drag = cropDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const image = event.currentTarget.querySelector('.crop-image-wrap img')
    const crop = image ? cropBetween(drag.start, pointOnImage(event, image)) : null
    cropDragRef.current = null
    setCropDraft(null)
    if (Math.hypot(event.clientX - drag.pointerStartX, event.clientY - drag.pointerStartY) < 5) {
      setIsPanMode((current) => !current)
      return
    }
    if (!crop || crop.width < minimumCropSize || crop.height < minimumCropSize) return
    setPhotos((current) => current.map((photo, index) => (
      index === activePhoto ? { ...photo, crop, evaluation: null, observations: defaultObservations } : photo
    )))
  }

  const changeZoom = (direction) => {
    const next = Math.max(
      minimumImageZoom,
      Math.min(maximumImageZoom, imageZoom + direction * imageZoomStep),
    )
    setImageZoom(next)
    if (next <= 1) setImagePan({ x: 0, y: 0 })
  }

  const fitImage = () => {
    setImageZoom(1)
    setImagePan({ x: 0, y: 0 })
  }

  const clearCropSelection = () => {
    setCropDraft(null)
    setPhotos((current) => current.map((photo, index) => (
      index === activePhoto ? { ...photo, crop: null } : photo
    )))
  }

  const resetReview = () => {
    if (isAnalyzing) return
    photos.forEach(({ url }) => {
      URL.revokeObjectURL(url)
      objectUrls.current.delete(url)
    })
    setPhotos([])
    setActivePhoto(0)
    resetImageView()
    setUploadMessage('')
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="app-shell" data-theme={theme}>
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label={t.home}>
          <span className="wordmark-mark">S<span>/</span>C</span>
          <span className="wordmark-name">STICKER CHECK</span>
        </a>
        <div className="topbar-actions">
          <label className="language-picker">
            <span>{t.language}</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value)} aria-label={t.language}>
              {languages.map((code) => <option key={code} value={code}>{t.languageNames[code]}</option>)}
            </select>
          </label>
          <button
            className="theme-toggle"
            type="button"
            onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? t.switchToLightTheme : t.switchToDarkTheme}
            title={theme === 'dark' ? t.switchToLightTheme : t.switchToDarkTheme}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      <main id="top" className="page-content">
        <section className="intro">
          <div>
            <h1>{t.titleStart} <em>{t.titleEmphasis}</em></h1>
            <p className="intro-copy">{t.intro}</p>
          </div>
          <button className="reset-button" type="button" onClick={resetReview} disabled={!photos.length || isAnalyzing}>
            <RotateCcw size={15} strokeWidth={1.8} /> {t.reset}
          </button>
        </section>

        {photos.length > 1 && (
          <p className="donation-note donation-note-top">
            {t.donationNote}{' '}
            <a href="https://paypal.me/nunorodrigues1977" target="_blank" rel="noreferrer">
              paypal.me/nunorodrigues1977
            </a>
          </p>
        )}

        <section className="review-layout" aria-label={t.reviewLabel}>
          <div className="review-main">
            <section className="photo-section" aria-label={t.photoLabel}>
              <div className="section-heading photo-heading">
                <div className="heading-index">01</div>
                <div><h2>{t.photoReview}</h2><p>{t.photoHelp}</p></div>
                {(photos.length > 0 || isUploadLocked) && (
                  <button
                    className="add-photo-button"
                    type="button"
                    onClick={() => isUploadLocked ? setIsUnlockDialogOpen(true) : inputRef.current?.click()}
                    disabled={isAnalyzing}
                  >
                    <ImagePlus size={16} /> {isUploadLocked ? t.enterUnlockKey : t.addPhotos}
                  </button>
                )}
              </div>

              <input
                ref={inputRef}
                className="visually-hidden"
                type="file"
                disabled={isAnalyzing || isUploadLocked}
                aria-label={t.addPhotos}
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                onChange={(event) => {
                  addPhotos(event.target.files)
                  event.target.value = ''
                }}
              />

              <div
                className={`photo-stage${isDragging ? ' is-dragging' : ''}${photos.length ? ' has-photo' : ''}${currentPhoto?.status === 'pending' ? ' is-selectable' : ''}${isPanMode ? ' is-panning' : ''}`}
                onPointerDown={startCropSelection}
                onPointerMove={updateCropDraft}
                onPointerUp={finishCropSelection}
                onPointerCancel={finishCropSelection}
                onDragOver={(event) => { event.preventDefault(); setIsDragging(true) }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) setIsDragging(false)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  setIsDragging(false)
                  addPhotos(event.dataTransfer.files)
                }}
              >
                {photos.length ? (
                  <>
                    {currentPhoto?.status === 'pending' && (
                      <div className="image-controls" onPointerDown={(event) => event.stopPropagation()}>
                        <div className="zoom-controls" aria-label={t.imageZoom}>
                          <button type="button" onClick={() => changeZoom(-1)} aria-label={t.zoomOut} title={t.zoomOut} disabled={imageZoom <= minimumImageZoom}>
                            <ZoomOut size={15} />
                          </button>
                          <span className="zoom-level" aria-live="polite">{Math.round(imageZoom * 100)}%</span>
                          <button type="button" onClick={() => changeZoom(1)} aria-label={t.zoomIn} title={t.zoomIn} disabled={imageZoom >= maximumImageZoom}>
                            <ZoomIn size={15} />
                          </button>
                          <button type="button" onClick={fitImage} aria-label={t.fitImage} title={t.fitImage}>
                            <Maximize2 size={14} />
                          </button>
                        </div>
                        <button
                          className={`pan-toggle${isPanMode ? ' active' : ''}`}
                          type="button"
                          onClick={() => setIsPanMode((current) => !current)}
                          aria-label={isPanMode ? t.selectArea : t.moveImage}
                          aria-pressed={isPanMode}
                          title={isPanMode ? t.selectArea : t.moveImage}
                        >
                          <Hand size={15} />
                        </button>
                      </div>
                    )}
                    <div
                      className="crop-image-wrap"
                      style={{
                        '--image-zoom': imageZoom,
                        '--image-pan-x': `${imagePan.x}px`,
                        '--image-pan-y': `${imagePan.y}px`,
                      }}
                    >
                      <img className="active-photo" src={currentPhoto?.url} alt={`${t.uploadedPhoto}: ${currentPhoto?.name}`} draggable="false" />
                      {currentPhoto?.status === 'pending' && (
                        <div
                          className="crop-selection"
                          style={{
                            left: `${(cropDraft ?? currentPhoto.crop)?.x * 100 || 0}%`,
                            top: `${(cropDraft ?? currentPhoto.crop)?.y * 100 || 0}%`,
                            width: `${(cropDraft ?? currentPhoto.crop)?.width * 100 || 0}%`,
                            height: `${(cropDraft ?? currentPhoto.crop)?.height * 100 || 0}%`,
                            display: cropDraft || currentPhoto.crop ? 'block' : 'none',
                          }}
                          aria-hidden="true"
                        />
                      )}
                    </div>
                    <div className="photo-count">{String(activePhoto + 1).padStart(2, '0')} <span>/</span> {String(photos.length).padStart(2, '0')}</div>
                    {photos.length > 1 && (
                      <div className="photo-navigation">
                        <button type="button" aria-label={t.previousPhoto} onClick={() => changePhoto(-1)}><ArrowLeft size={17} /></button>
                        <button type="button" aria-label={t.nextPhoto} onClick={() => changePhoto(1)}><ArrowRight size={17} /></button>
                      </div>
                    )}
                  </>
                ) : (
                  <button
                    className="upload-prompt"
                    type="button"
                    onClick={() => isUploadLocked ? setIsUnlockDialogOpen(true) : inputRef.current?.click()}
                  >
                    <span className="upload-icon"><Upload size={21} strokeWidth={1.7} /></span>
                    <span className="upload-title">{isUploadLocked ? t.photoLimitReached : t.dropPhotos}</span>
                    {!isUploadLocked && <span className="upload-subtitle">{t.or} <span className="browse-link">{t.browse}</span></span>}
                    <span className="upload-meta">{t.uploadMeta}</span>
                  </button>
                )}
              </div>

              {uploadMessage && <p className="upload-message" role="alert">{uploadMessage}</p>}

              {currentPhoto?.status === 'pending' && (
                <div className="photo-action">
                  <p>{currentPhoto.crop
                    ? t.selectedCropHelp
                    : t.fullPhotoHelp}</p>
                  <div className="photo-action-buttons">
                    {currentPhoto.crop && (
                      <button className="clear-crop-button" type="button" onClick={clearCropSelection}>{t.useFullPhoto}</button>
                    )}
                    <button className="analyze-button" type="button" onClick={() => { void evaluatePhoto(currentPhoto) }}>
                      {currentPhoto.crop ? t.analyzeSelected : t.analyzeFull}
                    </button>
                  </div>
                </div>
              )}
              {currentPhoto?.status === 'analyzing' && (
                <p className="analysis-status" role="status">{currentPhoto.crop ? t.analyzingSelected : t.analyzingFull}</p>
              )}
              {isAnalyzing && currentPhoto?.status !== 'analyzing' && (
                <p className="analysis-status" role="status">{t.waitForAnalysis}</p>
              )}
              {currentPhoto?.status === 'ready' && (
                <p className="analysis-status" role="status">{currentPhoto.crop ? t.completeSelected : t.completeFull}</p>
              )}

              {photos.length > 0 && (
                <div className="photo-strip" aria-label={t.thumbnails}>
                  {photos.map((photo, index) => (
                    <div className={`thumbnail-wrap${index === activePhoto ? ' selected' : ''}`} key={photo.id}>
                      <button className="thumbnail" type="button" onClick={() => { setActivePhoto(index); resetImageView() }} aria-label={`${t.viewPhoto} ${index + 1}: ${photo.name}`} aria-pressed={index === activePhoto}>
                        <img src={photo.url} alt="" />
                      </button>
                      <button className="remove-photo" type="button" onClick={() => removePhoto(photo.id)} aria-label={`${t.removePhoto} ${photo.name}`} title={t.removePhoto} disabled={isAnalyzing}><X size={13} /></button>
                    </div>
                  ))}
                  <button className="thumbnail-add" type="button" onClick={() => inputRef.current?.click()} aria-label={t.addAnotherPhoto} disabled={isAnalyzing || isUploadLocked}><ImagePlus size={17} /></button>
                  <span className="photo-strip-label">{photos.length} {photos.length === 1 ? t.image : t.images}</span>
                </div>
              )}
            </section>

            <section className="criteria-section" aria-label={t.conditionNotes}>
              <div className="section-heading criteria-heading">
                <div className="heading-index">02</div>
                <div><h2>{t.conditionNotes}</h2><p>{t.conditionHelp}</p></div>
              </div>
              <div className="criteria-list">
                {criteria.map((criterion, index) => {
                  const text = t.criteria[criterion.id]
                  return (
                  <label className="criterion-row" key={criterion.id}>
                    <span className="criterion-number">0{index + 1}</span>
                    <span className="criterion-name">
                      <strong>{text.name}</strong>
                      <small>{text.note}</small>
                      {currentPhoto?.evaluation && (
                        <small className="ai-note">{currentPhoto.evaluation.notes[criterion.id]}</small>
                      )}
                    </span>
                    <select
                      value={observations[criterion.id]}
                      onChange={(event) => setPhotos((current) => current.map((photo, photoIndex) => (
                        photoIndex === activePhoto
                          ? { ...photo, observations: { ...photo.observations, [criterion.id]: Number(event.target.value) } }
                          : photo
                      )))}
                      aria-label={`${text.name} ${t.conditionLabel}`}
                      disabled={currentPhoto?.status !== 'ready' || !currentPhoto.evaluation?.isSticker}
                    >
                      {criterion.values.map((value, optionIndex) => (
                        <option key={value} value={value}>{text.options[optionIndex]}</option>
                      ))}
                    </select>
                  </label>
                  )
                })}
              </div>
            </section>
          </div>

          <aside className="score-panel" aria-live="polite">
            <div className="score-topline"><span>{t.estimate}</span></div>
            <div className={`score-display${score === null ? ' is-empty' : ''}${currentPhoto?.status === 'analyzing' ? ' is-analyzing' : ''}`}>
              <div className="score-ring" style={{ '--score-progress': `${(score ?? 0) * 10}%` }}>
                <div className="score-ring-inner">
                  <span className="score-number">{score ?? '—'}</span>
                  <span className="score-out-of">{score === null
                    ? currentPhoto?.status === 'analyzing' ? t.analyzing : currentPhoto?.evaluation?.isSticker === false ? t.noGrade : t.outOfTen
                    : t.outOfTen}</span>
                </div>
              </div>
              <p className="grade-range">{score === null
                ? currentPhoto?.status === 'analyzing'
                  ? t.evaluating
                  : currentPhoto?.status === 'error'
                    ? t.evaluationFailed
                    : currentPhoto?.evaluation?.isSticker === false ? t.stickerUnconfirmed : t.awaitingPhotos
                : gradeLabel(score, t)}</p>
              <p className="grade-caption">{score === null
                ? currentPhoto?.status === 'analyzing'
                  ? t.takesSeconds
                  : currentPhoto?.evaluation?.isSticker === false
                    ? t.stickerVisibility
                    : t.uploadToBegin
                : t.unofficialEstimate}</p>
              {currentPhoto?.status === 'ready' && (
                <p className="evaluation-summary">{currentPhoto.evaluation.summary}</p>
              )}
            </div>

            {currentPhoto?.status === 'ready' && (
              <div className="export-action">
                <button className="export-results" type="button" onClick={() => { void exportResults() }} disabled={isExporting}>
                  <Download size={15} /> {isExporting ? t.exportingResults : t.exportResults}
                </button>
                {exportMessage && <p className="export-message" role="alert">{exportMessage}</p>}
              </div>
            )}

            {currentPhoto?.status === 'error' && (
              <div className="evaluation-error" role="alert">
                <p>{currentPhoto.error}</p>
                <button type="button" onClick={() => { void evaluatePhoto(currentPhoto) }}>{t.retry}</button>
              </div>
            )}

            <div className="score-breakdown">
              <div className="breakdown-heading"><span>{t.areaBreakdown}</span><span>{t.weight}</span></div>
              {criteria.map((criterion) => (
                <div className="breakdown-row" key={criterion.id}>
                  <span>{t.criteria[criterion.id].name}</span>
                  <div className="breakdown-track"><span style={{ width: `${(observations[criterion.id] / 10) * 100}%` }} /></div>
                  <strong>{score === null ? '—' : observations[criterion.id]}</strong>
                </div>
              ))}
            </div>

            <div className="score-footnote">
              <span className="footnote-mark">i</span>
              <p>{t.limitations}</p>
            </div>
          </aside>
        </section>

        {(isDonationDialogOpen || isUnlockDialogOpen) && (
          <div
            className="dialog-backdrop"
            onClick={(event) => {
              if (event.target !== event.currentTarget) return
              setIsDonationDialogOpen(false)
              setIsUnlockDialogOpen(false)
            }}
          >
            <section className="donation-dialog" role="dialog" aria-modal="true" aria-labelledby="donation-dialog-title">
              <button
                className="dialog-close"
                type="button"
                aria-label={t.closeDialog}
                onClick={() => {
                  setIsDonationDialogOpen(false)
                  setIsUnlockDialogOpen(false)
                }}
              >
                <X size={18} />
              </button>
              <p className="dialog-eyebrow">{isUnlockDialogOpen ? t.photoLimitEyebrow : t.donationEyebrow}</p>
              <h2 id="donation-dialog-title">{isUnlockDialogOpen ? t.photoLimitTitle : t.donationTitle}</h2>
              <p className="dialog-copy">{isUnlockDialogOpen ? t.photoLimitBody : t.donationDialogBody}</p>
              <p className="donation-note">
                {t.donationNote}{' '}
                <a href="https://paypal.me/nunorodrigues1977" target="_blank" rel="noreferrer">
                  paypal.me/nunorodrigues1977
                </a>
              </p>
              {isUnlockDialogOpen && (
                <form
                  className="unlock-form"
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (isVerifyingUnlockKey) return
                    setIsVerifyingUnlockKey(true)
                    setUnlockMessage('')
                    fetch('/api/unlock', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ key: unlockKey.trim() }),
                    })
                      .then(async (response) => {
                        let result
                        try {
                          result = await response.json()
                        } catch {
                          throw new Error(t.keyValidationUnavailable)
                        }
                        if (!response.ok) {
                          throw new Error(response.status === 401 ? t.keyValidationInvalid : result.error || t.keyValidationUnavailable)
                        }
                        setIsUploadUnlocked(true)
                        setIsUploadLocked(false)
                        window.localStorage.setItem(uploadUnlockedStorageKey, 'true')
                        window.localStorage.setItem(uploadLockStorageKey, 'false')
                        setUnlockMessage(t.keyValidationSuccess)
                      })
                      .catch((error) => {
                        setUnlockMessage(error.message || t.keyValidationUnavailable)
                      })
                      .finally(() => setIsVerifyingUnlockKey(false))
                  }}
                >
                  <label htmlFor="unlock-key">{t.unlockKeyLabel}</label>
                  <input
                    id="unlock-key"
                    type="text"
                    value={unlockKey}
                    onChange={(event) => {
                      setUnlockKey(event.target.value)
                      setUnlockMessage('')
                    }}
                    placeholder={t.unlockKeyPlaceholder}
                    autoComplete="off"
                  />
                  <button type="submit" disabled={!unlockKey.trim() || isVerifyingUnlockKey}>
                    {isVerifyingUnlockKey ? t.verifyingKey : t.verifyKey}
                  </button>
                  {unlockMessage && <p className="unlock-message" role="status">{unlockMessage}</p>}
                </form>
              )}
              {!isUnlockDialogOpen && (
                <button className="dialog-action" type="button" onClick={() => setIsDonationDialogOpen(false)}>
                  {t.closeDialog}
                </button>
              )}
            </section>
          </div>
        )}

        <footer className="page-footer">
          <span>STICKER CHECK <span className="footer-dot">/</span> {t.footerTool}</span>
          <span>{t.photosStayLocal}</span>
        </footer>
      </main>
    </div>
  )
}

export default App
