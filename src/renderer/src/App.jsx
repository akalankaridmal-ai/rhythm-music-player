import { useState, useRef, useEffect } from 'react'
import defaultArt from './assets/default-art.png'

const DEFAULT_BG = '#3a1c71'

const toUrl = (p) => 'media://local/' + encodeURIComponent(p)
const fileName = (p) => p.split(/[\\/]/).pop().replace(/\.[^.]+$/, '')
const folderName = (f) => f.split(/[\\/]/).pop() || f
const fmt = (s) => {
  if (!isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60).toString().padStart(2, '0')
  return `${m}:${sec}`
}
const scanAll = async (folders) => {
  const lists = await Promise.all(folders.map((f) => window.api.scanFolder(f)))
  return [...new Set(lists.flat())].sort((a, b) => fileName(a).localeCompare(fileName(b)))
}

// Average color of an image, darkened so white text stays readable
const getColor = (src) =>
  new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = c.height = 16
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0, 16, 16)
      const d = ctx.getImageData(0, 0, 16, 16).data
      let r = 0, g = 0, b = 0, n = 0
      for (let i = 0; i < d.length; i += 4) {
        r += d[i]
        g += d[i + 1]
        b += d[i + 2]
        n++
      }
      resolve([r, g, b].map((v) => Math.round((v / n) * 0.6)))
    }
    img.onerror = () => resolve(null)
    img.src = src
  })

// Icons (they take their color from CSS, so they can turn green when on)
const iconProps = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
}

const ShuffleIcon = () => (
  <svg {...iconProps}>
    <polyline points="16 3 21 3 21 8" />
    <line x1="4" y1="20" x2="21" y2="3" />
    <polyline points="21 16 21 21 16 21" />
    <line x1="15" y1="15" x2="21" y2="21" />
    <line x1="4" y1="4" x2="9" y2="9" />
  </svg>
)

const RepeatIcon = ({ one }) => (
  <svg {...iconProps}>
    <polyline points="17 1 21 5 17 9" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <polyline points="7 23 3 19 7 15" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    {one && (
      <text
        x="12"
        y="15.5"
        fontSize="9"
        fontWeight="700"
        textAnchor="middle"
        fill="currentColor"
        stroke="none"
      >
        1
      </text>
    )}
  </svg>
)

const VIEWS = { library: 'Library', recent: 'Recently played', most: 'Most played' }

function App() {
  const audioRef = useRef(null)
  const historyRef = useRef([])
  const coverReq = useRef(null)
  const toggleRef = useRef(null)
  const nextRef = useRef(null)
  const prevRef = useRef(null)
  const bagRef = useRef([]) // songs still to come in the current shuffle round

  const [loaded, setLoaded] = useState(false)
  const [folders, setFolders] = useState([])
  const [library, setLibrary] = useState([])
  const [stats, setStats] = useState({})
  const [meta, setMeta] = useState({})
  const [cover, setCover] = useState(null)
  const [bgColor, setBgColor] = useState(DEFAULT_BG)
  const [view, setView] = useState('library')
  const [activeFolder, setActiveFolder] = useState(null)
  const [query, setQuery] = useState('')

  const [queue, setQueue] = useState([])
  const [trackPath, setTrackPath] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.8)
  const [muted, setMuted] = useState(false)
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState('off') // 'off' | 'all' | 'one'
  const [error, setError] = useState('')

  // Load saved data and rescan folders on startup
  useEffect(() => {
    ;(async () => {
      const data = await window.api.loadData()
      const savedFolders = data.folders || []
      setFolders(savedFolders)
      setStats(data.stats || {})
      setMeta(data.meta || {})
      setVolume(data.volume ?? 0.8)
      setShuffle(data.shuffle ?? false)
      setRepeat(data.repeat ?? 'off')
      setLibrary(await scanAll(savedFolders))
      setLoaded(true)
    })()
  }, [])

  // Read tags (title, artist, album) for songs we haven't seen yet
  useEffect(() => {
    if (!loaded) return
    const missing = library.filter((p) => !meta[p])
    if (!missing.length) return
    let cancelled = false
    ;(async () => {
      for (let i = 0; i < missing.length; i += 20) {
        const chunk = missing.slice(i, i + 20)
        const tags = await Promise.all(chunk.map((p) => window.api.getTags(p)))
        if (cancelled) return
        setMeta((m) => {
          const copy = { ...m }
          chunk.forEach((p, j) => {
            copy[p] = tags[j]
          })
          return copy
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loaded, library])

  // Save whenever something important changes
  useEffect(() => {
    if (!loaded) return
    const t = setTimeout(() => {
      window.api.saveData({ folders, stats, meta, volume, shuffle, repeat })
    }, 400)
    return () => clearTimeout(t)
  }, [loaded, folders, stats, meta, volume, shuffle, repeat])

  // Apply volume
  useEffect(() => {
    audioRef.current.volume = muted ? 0 : volume
  }, [volume, muted])

  // Background color follows the album cover
  useEffect(() => {
    if (!cover) {
      setBgColor(DEFAULT_BG)
      return
    }
    let cancelled = false
    getColor(cover).then((rgb) => {
      if (!cancelled && rgb) setBgColor(`rgb(${rgb.join(',')})`)
    })
    return () => {
      cancelled = true
    }
  }, [cover])

  const titleOf = (p) => meta[p]?.title || fileName(p)

  const addFolder = async () => {
    const dir = await window.api.openFolder()
    if (!dir || folders.includes(dir)) return
    const updated = [...folders, dir]
    setFolders(updated)
    setLibrary(await scanAll(updated))
  }

  const removeFolder = async (f) => {
    const updated = folders.filter((x) => x !== f)
    setFolders(updated)
    setLibrary(await scanAll(updated))
    if (activeFolder === f) {
      setActiveFolder(null)
      setView('library')
    }
  }

  // The list shown in the main area
  const inFolder = (p) => {
    const base = activeFolder.replace(/[\\/]+$/, '')
    return p.startsWith(base + '\\') || p.startsWith(base + '/')
  }

  const baseList =
    view === 'folder' && activeFolder
      ? library.filter(inFolder)
      : view === 'recent'
        ? library.filter((p) => stats[p]?.last).sort((a, b) => stats[b].last - stats[a].last).slice(0, 50)
        : view === 'most'
          ? library.filter((p) => stats[p]?.plays).sort((a, b) => stats[b].plays - stats[a].plays).slice(0, 50)
          : library

  const q = query.trim().toLowerCase()
  const visible = q
    ? baseList.filter((p) =>
        `${titleOf(p)} ${meta[p]?.artist || ''} ${meta[p]?.album || ''}`.toLowerCase().includes(q)
      )
    : baseList

  const viewTitle = view === 'folder' && activeFolder ? folderName(activeFolder) : VIEWS[view]

  const playTrack = (path, list = queue, isBack = false) => {
    const audio = audioRef.current
    setError('')
    setQueue(list)
    if (!isBack) {
      if (trackPath) historyRef.current.push(trackPath)
      setStats((s) => ({
        ...s,
        [path]: { plays: (s[path]?.plays || 0) + 1, last: Date.now() }
      }))
    }
    setTrackPath(path)
    audio.src = toUrl(path)
    audio.play().catch((err) => console.error(err))

    // Load the album cover for this song
    setCover(null)
    coverReq.current = path
    window.api.getCover(path).then((c) => {
      if (coverReq.current === path) setCover(c)
    })
  }

  // Used only for the very first song when shuffle is on
  const randomFrom = (list) => {
    let p
    do {
      p = list[Math.floor(Math.random() * list.length)]
    } while (list.length > 1 && p === trackPath)
    return p
  }

  // Shuffle: play every song once in random order, then reshuffle
  const shuffleNext = () => {
    let bag = bagRef.current
    if (!bag.length) {
      bag = queue.filter((p) => p !== trackPath)
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[bag[i], bag[j]] = [bag[j], bag[i]]
      }
      if (!bag.length) bag = [...queue] // only one song in the list
    }
    const p = bag.shift()
    bagRef.current = bag
    return p
  }

  const toggleShuffle = () => {
    bagRef.current = []
    setShuffle((s) => !s)
  }

  const playFromList = (path) => {
    bagRef.current = []
    playTrack(path, visible)
  }

  const togglePlay = () => {
    const audio = audioRef.current
    if (!trackPath) {
      if (visible.length) {
        bagRef.current = []
        playTrack(shuffle ? randomFrom(visible) : visible[0], visible)
      }
      return
    }
    audio.paused ? audio.play() : audio.pause()
  }
  toggleRef.current = togglePlay

  // Spacebar = play / pause
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== 'Space') return
      const tag = e.target.tagName
      if (tag === 'TEXTAREA' || (tag === 'INPUT' && e.target.type !== 'range')) return
      e.preventDefault()
      if (tag === 'BUTTON') e.target.blur() // stops the space key from also "clicking" the button
      toggleRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const next = () => {
    if (!queue.length) return
    if (shuffle) return playTrack(shuffleNext())
    const i = queue.indexOf(trackPath)
    playTrack(queue[(i + 1) % queue.length])
  }

  const prev = () => {
    const audio = audioRef.current
    if (audio.currentTime > 3 || !historyRef.current.length) {
      audio.currentTime = 0
      return
    }
    playTrack(historyRef.current.pop(), queue, true)
  }
  nextRef.current = next
  prevRef.current = prev

  // Keyboard media keys (sent from the main process)
  useEffect(() => {
    return window.api.onMediaKey((action) => {
      if (action === 'toggle') toggleRef.current()
      else if (action === 'next') nextRef.current()
      else if (action === 'prev') prevRef.current()
      else if (action === 'stop') audioRef.current.pause()
    })
  }, [])

  // What happens when a song finishes
  const handleEnded = () => {
    const audio = audioRef.current
    if (repeat === 'one') {
      audio.currentTime = 0
      audio.play()
      return
    }
    // Repeat off: stop after the last song in the list
    if (!shuffle && repeat === 'off' && queue.indexOf(trackPath) === queue.length - 1) return
    next()
  }

  const cycleRepeat = () =>
    setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'))

  const seek = (e) => {
    if (!duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    audioRef.current.currentTime = ((e.clientX - rect.left) / rect.width) * duration
  }

  const title = trackPath ? titleOf(trackPath) : 'No song playing'
  const artist = trackPath ? meta[trackPath]?.artist || 'Unknown artist' : 'Pick a song to start'
  const album = trackPath ? meta[trackPath]?.album : ''
  const artStyle = cover
    ? { backgroundImage: `url("${cover}")` }
    : {
        backgroundImage: `url("${defaultArt}")`,
        backgroundColor: '#fff',
        backgroundSize: 'contain',
        backgroundRepeat: 'no-repeat'
      }
  const percent = duration ? (current / duration) * 100 : 0
  const volIcon = muted || volume === 0 ? '🔇' : volume < 0.5 ? '🔉' : '🔊'

  return (
    <div className="app">
      <audio
        ref={audioRef}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.target.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.target.duration)}
        onEnded={handleEnded}
        onError={(e) => setError(`Can't play this file (error code ${e.target.error?.code})`)}
      />

      <div className="titlebar">Rhythm</div>

      <aside className="sidebar">
        <h2 className="logo">🎵 Rhythm</h2>
        <nav>
          {Object.entries(VIEWS).map(([key, label]) => (
            <a
              key={key}
              className={'nav-item' + (view === key ? ' active' : '')}
              onClick={() => setView(key)}
            >
              {label}
            </a>
          ))}
        </nav>

        <button className="open-btn" onClick={addFolder}>
          + Add folder
        </button>
        {folders.map((f) => (
          <div
            key={f}
            className={'folder' + (view === 'folder' && activeFolder === f ? ' active' : '')}
            title={f}
            onClick={() => {
              setView('folder')
              setActiveFolder(f)
            }}
          >
            <span className="folder-name">📁 {folderName(f)}</span>
            <button
              className="folder-remove"
              title="Remove folder"
              onClick={(e) => {
                e.stopPropagation()
                removeFolder(f)
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </aside>

      <main className="main" style={{ '--bg-color': bgColor }}>
        <div className="searchbar">
          <input
            className="search"
            type="text"
            placeholder="🔍  Search songs, artists or albums"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="content">
          <section className="now-playing">
            <div className="album-art" style={artStyle} />
            <h1 className="song-title">{title}</h1>
            <p className="song-artist">
              {artist}
              {album ? ` · ${album}` : ''}
            </p>
            {error && <p className="error">{error}</p>}
          </section>

          <section className="tracklist">
            <h2 className="view-title">{viewTitle}</h2>
            {visible.length === 0 && (
              <p className="empty">
                {q
                  ? 'No songs match your search.'
                  : view === 'library'
                    ? 'Your library is empty. Click "+ Add folder" to add your music.'
                    : view === 'folder'
                      ? 'No supported songs found in this folder.'
                      : 'Nothing here yet. Play some songs first.'}
              </p>
            )}
            {visible.map((p) => (
              <div
                key={p}
                className={'track-row' + (p === trackPath ? ' active' : '')}
                onClick={() => playFromList(p)}
              >
                <span className="row-name">{titleOf(p)}</span>
                <span className="row-artist">{meta[p]?.artist || ''}</span>
                {view === 'most' && <span className="row-meta">{stats[p].plays} plays</span>}
              </div>
            ))}
          </section>
        </div>
      </main>

      <footer className="player-bar">
        <div className="track-info">
          <div className="mini-art" style={artStyle} />
          <div className="mini-text">
            <div className="mini-title">{title}</div>
            <div className="mini-artist">{trackPath ? artist : ''}</div>
          </div>
        </div>

        <div className="controls">
          <div className="buttons">
            <button
              className={'btn icon-btn' + (shuffle ? ' on' : '')}
              onClick={toggleShuffle}
              title={shuffle ? 'Shuffle: on' : 'Shuffle: off'}
            >
              <ShuffleIcon />
            </button>
            <button className="btn" onClick={prev}>⏮</button>
            <button className="btn play" onClick={togglePlay}>
              {isPlaying ? '⏸' : '▶'}
            </button>
            <button className="btn" onClick={next}>⏭</button>
            <button
              className={'btn icon-btn' + (repeat !== 'off' ? ' on' : '')}
              onClick={cycleRepeat}
              title={`Repeat: ${repeat}`}
            >
              <RepeatIcon one={repeat === 'one'} />
            </button>
          </div>
          <div className="progress-row">
            <span>{fmt(current)}</span>
            <div className="progress" onClick={seek}>
              <div className="progress-fill" style={{ width: percent + '%' }} />
            </div>
            <span>{fmt(duration)}</span>
          </div>
        </div>

        <div className="volume">
          <button className="btn" onClick={() => setMuted(!muted)}>{volIcon}</button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={muted ? 0 : volume}
            onChange={(e) => {
              setVolume(Number(e.target.value))
              setMuted(false)
            }}
          />
        </div>
      </footer>
    </div>
  )
}

export default App