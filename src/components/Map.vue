<script lang="ts" setup>
import { onMounted, ref } from 'vue'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import {
  CompassOutlined,
  CarOutlined,
  DashboardOutlined,
  FileTextOutlined,
} from '@ant-design/icons-vue'

//Types

interface RouteOption {
  index: number
  distance: string
  duration: string
  durationRaw: number
  steps: string[]
  label: string
  badge: string
  pros: string[]
  cons: string[]
}

interface TravelMode {
  id: string
  label: string
}

interface NotificationState {
  msg: string
  type: 'error' | 'warning' | 'success'
}

const collapsed = ref<boolean>(false)
const selectedKeys = ref<string[]>([])
const navPanelOpen = ref<boolean>(false)

const distance = ref<string | null>(null)
const duration = ref<string | null>(null)
const instructions = ref<string[]>([])
const selectedMode = ref<string | null>(null)
const alternativeRoutes = ref<RouteOption[]>([])
const selectedRouteIndex = ref<number>(0)
const searchQuery = ref<string>('')
const searchResults = ref<any[]>([])
const isSearching = ref<boolean>(false)
const notification = ref<NotificationState | null>(null)
const originName = ref<string | null>(null)
const destinationName = ref<string | null>(null)
const formPanelOpen = ref<boolean>(false)
// const formKeys = ref<string[]>([])
const formData = ref({
  employeeNumber: '',
  employeeName: '',
  branch: '',
  address: '',
  distanceKm: '',
  distanceAmount: '',
  psoDistanceKm: '',
  psoDistanceAmount: '',
  pso: '',
})

// Two-phase click:
// 'idle'        → waiting for first click (zoom to origin)
// 'origin-zoom' → zoomed in, waiting for confirm click
// 'dest-idle'   → origin placed, waiting for dest zoom click
// 'dest-zoom'   → zoomed in on dest, waiting for confirm click



const clickPhase = ref<string>('idle')
const pendingCoords = ref<[number, number] | null>(null)

// Non-reactive map vars

let map: mapboxgl.Map
let originMarker: mapboxgl.Marker | null = null
let destinationMarker: mapboxgl.Marker | null = null
let previewMarker: mapboxgl.Marker | null = null
let currentOrigin: [number, number] | null = null
let currentDestination: [number, number] | null = null
let searchMarker: mapboxgl.Marker | null = null
let notifTimeout: ReturnType<typeof setTimeout> | null = null

// Constants

const travelModes: TravelMode[] = [
  { id: 'driving-traffic', label: 'Drive' },
  { id: 'driving', label: 'No Traffic' },
]

const routeColors: string[] = ['#3b82f6', '#f59e0b', '#10b981']

// Utilities

function showNotif(msg: string, type: NotificationState['type'] = 'error'): void {
  notification.value = { msg, type }
  if (notifTimeout) clearTimeout(notifTimeout)
  notifTimeout = setTimeout(() => { notification.value = null }, 6000)
}

function haversineDistance(a: [number, number], b: [number, number]): number {
  const R = 6371
  const dLat = (b[1] - a[1]) * Math.PI / 180
  const dLon = (b[0] - a[0]) * Math.PI / 180
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * Math.PI / 180) *
    Math.cos(b[1] * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

function fitToRoute(coords: [number, number][]): void {
  const bounds = coords.reduce(
    (b, c) => b.extend(c),
    new mapboxgl.LngLatBounds(coords[0], coords[0])
  )
  map.fitBounds(bounds, { padding: { top: 80, bottom: 80, left: 80, right: 320 } })
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m} mins`
}

async function reverseGeocode(coords: [number, number]): Promise<string> {
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${coords[0]},${coords[1]}.json` +
    `?access_token=${mapboxgl.accessToken}&limit=1`
  const res = await fetch(url)
  const data = await res.json()
  return data.features?.[0]?.place_name ?? `${coords[1].toFixed(4)}, ${coords[0].toFixed(4)}`
}

// Preview ghost marker

function clearPreview(): void {
  if (previewMarker) { previewMarker.remove(); previewMarker = null }
}

function makePreviewEl(bgColor: string, borderColor: string, shadowColor: string): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = `
    width:20px;height:20px;border-radius:50%;
    background:${bgColor};border:3px dashed ${borderColor};
    box-shadow:0 0 0 6px ${shadowColor};pointer-events:none;
  `
  return el
}

//  Ground state 

function resetGroundState(): void {
  clearPreview()
  if (originMarker) { originMarker.remove(); originMarker = null }
  if (destinationMarker) { destinationMarker.remove(); destinationMarker = null }
  currentOrigin = null
  currentDestination = null
  originName.value = null
  destinationName.value = null
  clickPhase.value = 'idle'
  pendingCoords.value = null
  clearRoutes()
}

//  Map setup 

onMounted((): void => {
  mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

  map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/standard',
    center: [121.774, 12.8797],
    zoom: 5,
    pitch: 0,
  })

  map.on('load', (): void => {
    for (let i = 0; i < 3; i++) {
      map.addSource(`route-${i}`, {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} },
      })
      map.addLayer({
        id: `route-casing-${i}`,
        type: 'line',
        source: `route-${i}`,
        paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.4 },
      })
      map.addLayer({
        id: `route-${i}`,
        type: 'line',
        source: `route-${i}`,
        paint: {
          'line-color': routeColors[i],
          'line-width': i === 0 ? 6 : 4,
          'line-opacity': i === 0 ? 1 : 0.5,
          'line-dasharray': i === 0 ? [1] : [2, 2],
        },
      })
      const idx = i
      map.on('click', `route-${idx}`, (): void => {
        if (idx !== selectedRouteIndex.value) selectRoute(idx)
      })
      map.on('mouseenter', `route-${idx}`, (): void => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', `route-${idx}`, (): void => { map.getCanvas().style.cursor = '' })
    }
  })

  // Two-phase click handler
  map.on('click', async (e: mapboxgl.MapMouseEvent): Promise<void> => {
    if (!selectedMode.value) return

    const features = map.queryRenderedFeatures(e.point, {
      layers: ['route-0', 'route-1', 'route-2'],
    })
    if (features.length > 0) return

    const coords: [number, number] = [e.lngLat.lng, e.lngLat.lat]

    if (clickPhase.value === 'idle') {
      clearPreview()
      clearRoutes()
      destinationName.value = null
      currentDestination = null
      if (destinationMarker) { destinationMarker.remove(); destinationMarker = null }

      pendingCoords.value = coords
      clickPhase.value = 'origin-zoom'
      previewMarker = new mapboxgl.Marker({
        element: makePreviewEl('rgba(34,197,94,0.35)', '#22c55e', 'rgba(34,197,94,0.15)'),
        anchor: 'center',
      })
        .setLngLat(coords)
        .addTo(map)
      map.flyTo({ center: coords, zoom: 15, speed: 1.3 })
      showNotif('🔍 Zoomed in! Click again to confirm as your Origin 📍', 'warning')

    } else if (clickPhase.value === 'origin-zoom') {
      clearPreview()
      currentOrigin = coords
      originName.value = await reverseGeocode(coords)

      if (originMarker) originMarker.remove()
      originMarker = new mapboxgl.Marker({ color: '#22c55e', draggable: true })
        .setLngLat(coords)
        .addTo(map)
      originMarker.on('dragend', async (): Promise<void> => {
        const ll = originMarker!.getLngLat()
        currentOrigin = [ll.lng, ll.lat]
        originName.value = await reverseGeocode(currentOrigin)
        if (currentDestination) validateAndRoute(currentOrigin, currentDestination)
      })

      clickPhase.value = 'dest-idle'
      pendingCoords.value = null
      showNotif('✅ Origin set! Click the map to zoom in on your Destination 🎯', 'success')

    } else if (clickPhase.value === 'dest-idle') {
      clearPreview()
      pendingCoords.value = coords
      clickPhase.value = 'dest-zoom'
      previewMarker = new mapboxgl.Marker({
        element: makePreviewEl('rgba(239,68,68,0.35)', '#ef4444', 'rgba(239,68,68,0.15)'),
        anchor: 'center',
      })
        .setLngLat(coords)
        .addTo(map)
      map.flyTo({ center: coords, zoom: 15, speed: 1.3 })
      showNotif('🔍 Zoomed in! Click again to confirm your Destination 🎯', 'warning')

    } else if (clickPhase.value === 'dest-zoom') {
      clearPreview()
      currentDestination = coords
      destinationName.value = await reverseGeocode(coords)

      if (destinationMarker) destinationMarker.remove()
      destinationMarker = new mapboxgl.Marker({ color: '#ef4444', draggable: true })
        .setLngLat(coords)
        .addTo(map)
      destinationMarker.on('dragend', async (): Promise<void> => {
        const ll = destinationMarker!.getLngLat()
        currentDestination = [ll.lng, ll.lat]
        destinationName.value = await reverseGeocode(currentDestination)
        if (currentOrigin) validateAndRoute(currentOrigin, currentDestination)
      })

      clickPhase.value = 'idle'
      pendingCoords.value = null
      await validateAndRoute(currentOrigin!, currentDestination)
    }
  })
})

// Routing 

function clearRoutes(): void {
  distance.value = null
  duration.value = null
  instructions.value = []
  alternativeRoutes.value = []
  selectedRouteIndex.value = 0
  for (let i = 0; i < 3; i++) {
    if (map?.getSource(`route-${i}`)) {
      ;(map.getSource(`route-${i}`) as mapboxgl.GeoJSONSource).setData({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [] },
        properties: {},
      })
    }
  }
}

async function validateAndRoute(
  origin: [number, number],
  destination: [number, number]
): Promise<void> {
  await getGroundRoute(origin, destination)
}

function buildRouteMeta(routes: any[], mode: string): RouteOption[] {
  const fastest = routes[0]
  ;(buildRouteMeta as any)._highwayUsed = false

  return routes.map((r: any, i: number): RouteOption => {
    const distKm: number = r.distance / 1000
    const durMin: number = r.duration / 60
    const fastDurMin: number = fastest.duration / 60
    const fastDistKm: number = fastest.distance / 1000
    const timeDiffMin: number = Math.round(durMin - fastDurMin)
    const distDiffKm: string = (distKm - fastDistKm).toFixed(1)
    const steps: any[] = r.legs[0].steps
    const stepsPerKm: number = steps.length / Math.max(distKm, 0.1)
    const isHighwayLike: boolean = stepsPerKm < 1.5
    const isWindy: boolean = stepsPerKm > 3

    let label: string, badge: string, pros: string[], cons: string[]

    if (i === 0) {
      label = '⭐ Fastest Route'
      badge = 'fastest'
      pros = [
        'Shortest travel time',
        isHighwayLike ? 'Likely uses highways or expressways' : 'Optimized for current conditions',
      ]
      cons = []
      if (mode === 'driving-traffic') {
        pros.push('Accounts for live traffic data')
        cons.push('May change if traffic shifts')
      }
      if (isWindy) cons.push('More turns and intersections')

    } else if (distKm < fastDistKm) {
      label = '📏 Shortest Distance'
      badge = 'shortest'

      pros = [`Saves ${Math.abs(parseFloat(distDiffKm))} km vs fastest`, 'Less fuel consumption']
      cons = timeDiffMin > 0 ? [`+${timeDiffMin} min longer than fastest`] : []
      if (isWindy) { pros.push('Goes through local streets'); cons.push('More stops and turns') }
      if (mode === 'driving-traffic') cons.push('May pass through congested local roads')

    } else if (isHighwayLike && !(buildRouteMeta as any)._highwayUsed) {
      ;(buildRouteMeta as any)._highwayUsed = true
      label = '🛣️ Highway Route'
      badge = 'highway'
      pros = ['Smooth expressway driving', 'Fewer stops and traffic lights', 'Easier to maintain speed']
      cons = timeDiffMin > 0 ? [`+${timeDiffMin} min vs fastest`] : []
      cons.push(`+${distDiffKm} km longer distance`)
      if (mode === 'driving-traffic') cons.push('May have toll fees')

    } else {
      label = `🔀 Alternate Route ${i + 1}`
      badge = 'alt'
      pros = ['Avoids main route congestion', 'Useful if primary route is blocked']
      pros.push(isHighwayLike ? 'Uses wider roads' : 'Goes through local streets')
      cons = []
      if (timeDiffMin > 0) cons.push(`+${timeDiffMin} min longer`)
      if (parseFloat(distDiffKm) > 0) cons.push(`+${distDiffKm} km more distance`)
      if (isWindy) cons.push('More turns and junctions')
    }

    return {
      index: i,
      distance: distKm.toFixed(2) + ' km',
      duration: formatDuration(r.duration),
      durationRaw: r.duration,
      steps: steps.map((s: any): string => s.maneuver.instruction),
      label,
      badge,
      pros: pros.slice(0, 3),
      cons: cons.slice(0, 3),
    }
  })
}

async function getGroundRoute(
  origin: [number, number],
  destination: [number, number]
): Promise<void> {
  const mode = selectedMode.value!
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/${mode}/` +
    `${origin[0]},${origin[1]};${destination[0]},${destination[1]}` +
    `?geometries=geojson&steps=true&alternatives=true&access_token=${mapboxgl.accessToken}`

  const response = await fetch(url)
  const data = await response.json()

  if (!data.routes || data.routes.length === 0) {
    showNotif('🚫 No route found between these points.', 'error')
    resetGroundState()
    return
  }

  clearRoutes()

  data.routes.forEach((route: any, i: number): void => {
    if (i >= 3 || !map.getSource(`route-${i}`)) return
    ;(map.getSource(`route-${i}`) as mapboxgl.GeoJSONSource).setData({
      type: 'Feature',
      geometry: route.geometry,
      properties: {},
    })
  })

  alternativeRoutes.value = buildRouteMeta(data.routes, mode)
  selectRoute(0)
  fitToRoute(data.routes[0].geometry.coordinates as [number, number][])
}

function selectRoute(index: number): void {
  selectedRouteIndex.value = index
  for (let i = 0; i < 3; i++) {
    if (!map.getLayer(`route-${i}`)) continue
    map.setPaintProperty(`route-${i}`, 'line-width', i === index ? 6 : 4)
    map.setPaintProperty(`route-${i}`, 'line-opacity', i === index ? 1 : 0.4)
    map.setPaintProperty(`route-${i}`, 'line-dasharray', i === index ? [1] : [2, 2])
  }
  const sel = alternativeRoutes.value[index]
  if (sel) {
    distance.value = sel.distance
    duration.value = sel.duration
    instructions.value = sel.steps
  }
} 

// Mode switching 

function changeMode(mode: string): void {
  if (selectedMode.value === mode) {
    selectedMode.value = null
    resetGroundState()
    return
  }
  resetGroundState()
  selectedMode.value = mode
  showNotif('📍 Click the map to zoom in and set your Origin!', 'warning')
}

function resetAll(): void {
  selectedMode.value = null
  resetGroundState()
  map.flyTo({ center: [121.774, 12.8797], zoom: 5, pitch: 0, speed: 1.2 })
}

// Search 

let searchTimeout: ReturnType<typeof setTimeout> | null = null

function onSearchInput(): void {
  if (searchTimeout) clearTimeout(searchTimeout)
  if (!searchQuery.value.trim()) { searchResults.value = []; return }
  isSearching.value = true
  searchTimeout = setTimeout(doSearch, 400)
}

async function doSearch(): Promise<void> {
  const query = searchQuery.value.trim()
  if (!query) return
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?access_token=${mapboxgl.accessToken}&limit=5`
  const res = await fetch(url)
  const data = await res.json()
  searchResults.value = data.features ?? []
  isSearching.value = false
}

function selectPlace(place: any): void {
  const [lng, lat]: [number, number] = place.center
  searchResults.value = []
  searchQuery.value = place.place_name
  map.flyTo({ center: [lng, lat], zoom: 14, pitch: 0, speed: 1.4 })
  if (searchMarker) searchMarker.remove()
  searchMarker = new mapboxgl.Marker({ color: '#f97316' })
    .setLngLat([lng, lat])
    .setPopup(
      new mapboxgl.Popup().setHTML(
        `<b>🔍 ${place.text}</b><br/><small>${place.place_name}</small>`
      )
    )
    .addTo(map)
  searchMarker.togglePopup()
}

function clearSearch(): void {
  searchQuery.value = ''
  searchResults.value = []
  if (searchMarker) { searchMarker.remove(); searchMarker = null }
}

function toggleNav(): void {
  navPanelOpen.value = !navPanelOpen.value
  if (!navPanelOpen.value) {
    selectedKeys.value = []
  } else {
    selectedKeys.value = ['nav']
    formPanelOpen.value = false
    selectedKeys.value = selectedKeys.value.filter(k => k !== 'form')
  }
}

function toggleForm(): void {
  formPanelOpen.value = !formPanelOpen.value
  if (!formPanelOpen.value) {
    selectedKeys.value = selectedKeys.value.filter(k => k !== 'form')
  } else {
    selectedKeys.value = ['form']
    navPanelOpen.value = false
    selectedKeys.value = selectedKeys.value.filter(k => k !== 'nav')
  }
}

function submitForm(): void {
  console.log('Form submitted:', formData.value)
  // handle submission here later
  //
  //qwewqeqwewqewq
  //
  formPanelOpen.value = false
}
</script>

<template>
  <a-layout style="height: 100vh; overflow: hidden;">

    <!--Sidebar-->
    <a-layout-sider
      v-model:collapsed="collapsed"
      collapsible
      :width="220"
      :collapsed-width="60"
      theme="dark"
      style="z-index: 10;"
    >
      <!-- Brand -->
      <div class="sider-logo">
        <CompassOutlined class="logo-icon" />
        <span v-if="!collapsed" class="logo-text">Life Route</span>
      </div>

      <a-menu
        v-model:selectedKeys="selectedKeys"
        theme="dark"
        mode="inline"
      >
      <a-menu-item key="nav" @click="toggleNav">
          <template #icon><CarOutlined /></template>
          <span>Navigation</span>
        </a-menu-item>

      <a-menu-item key="form" @click="toggleForm">
        <template #icon><FileTextOutlined /></template>
        <span>Form</span>
      </a-menu-item>

      </a-menu>
    </a-layout-sider>

    <!--Content-->
    <a-layout style="position: relative; overflow: hidden;">

      <!-- Mapbox map fills entire content area -->
      <div
        id="map"
        style="position: fixed; inset: 0; width: 100%; height: 100%; z-index: 0;"
      />

      <!-- Notification toast -->
      <transition name="notif">
        <div v-if="notification" :class="['notif', notification.type]">
          {{ notification.msg }}
        </div>
      </transition>

      <!-- Search bar (top-left of map) -->
      <div class="search-container">
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input
            v-model="searchQuery"
            class="search-input"
            placeholder="Search any place..."
            @input="onSearchInput"
          />
          <button v-if="searchQuery" class="clear-btn" @click="clearSearch">✕</button>
        </div>
        <div v-if="searchResults.length" class="search-results">
          <div
            v-for="place in searchResults"
            :key="place.id"
            class="search-result-item"
            @click="selectPlace(place)"
          >
            <span class="result-icon">📍</span>
            <div>
              <div class="result-name">{{ place.text }}</div>
              <div class="result-full">{{ place.place_name }}</div>
            </div>
          </div>
        </div>
        <div v-if="isSearching" class="search-results">
          <div class="search-result-item">⏳ Searching...</div>
        </div>
      </div>

      
      <transition name="panel-slide">
        <div v-if="navPanelOpen" class="nav-panel">
          
          <button class="close-btn" @click="toggleNav">✕</button>

          <div class="panel-header">
            <h2>🗺️ Navigation</h2>
            <button
              v-if="selectedMode || currentOrigin"
              class="reset-btn"
              @click="resetAll"
            >↺ Reset</button>
          </div>

          <!-- Mode buttons -->
          <div class="section-label">Travel Mode</div>
          <div class="mode-selector">
            <button
              v-for="mode in travelModes"
              :key="mode.id"
              :class="['mode-btn', { active: selectedMode === mode.id }]"
              @click="changeMode(mode.id)"
            >
              <CarOutlined v-if="mode.id === 'driving-traffic'" class="mode-ant-icon" />
              <DashboardOutlined v-else class="mode-ant-icon" />
              <span class="mode-label">{{ mode.label }}</span>
              <span v-if="selectedMode === mode.id" class="active-dot" />
            </button>
          </div>

          <!-- Phase hint messages -->
          <div v-if="!selectedMode" class="hint-box">
            👆 Pick a travel mode to start
          </div>
          <div v-else-if="clickPhase === 'idle'" class="mode-notice ground">
            📍 <b>Click the map</b> to zoom in on your <span class="green">Origin</span><br />
            <small style="color:#666;">Confirm the exact spot after zooming</small>
          </div>
          <div v-else-if="clickPhase === 'origin-zoom'" class="mode-notice confirm">
            🔍 Zoomed in! <b>Click again</b> to confirm your <span class="green">Origin</span>
          </div>
          <div v-else-if="clickPhase === 'dest-idle'" class="mode-notice ground">
            🎯 <b>Click the map</b> to zoom in on your <span class="red">Destination</span>
          </div>
          <div v-else-if="clickPhase === 'dest-zoom'" class="mode-notice confirm">
            🔍 Zoomed in! <b>Click again</b> to confirm your <span class="red">Destination</span>
          </div>

          <!-- Origin / destination display -->
          <div v-if="originName" class="locations">
            <div class="location-item">
              <span class="dot green-dot" />
              <div class="location-text">
                <div class="loc-label">Origin</div>
                <div class="loc-name">{{ originName }}</div>
              </div>
              <button class="x-btn" @click="resetGroundState">✕</button>
            </div>
            <div v-if="destinationName" class="route-connector" />
            <div v-if="destinationName" class="location-item">
              <span class="dot red-dot" />
              <div class="location-text">
                <div class="loc-label">Destination</div>
                <div class="loc-name">{{ destinationName }}</div>
              </div>
            </div>
          </div>

          <!-- Stats -->
          <div v-if="distance && duration" class="stats">
            <div class="stat">
              <span class="lbl">📏 Distance</span>
              <span class="val">{{ distance }}</span>
            </div>
            <div class="stat">
              <span class="lbl">⏱️ Duration</span>
              <span class="val">{{ duration }}</span>
            </div>
          </div>

          <!-- Alternative routes with pros/cons -->
          <div v-if="alternativeRoutes.length > 0" class="alternatives">
            <h3>🔀 Route Options</h3>
            <div
              v-for="route in alternativeRoutes"
              :key="route.index"
              :class="['alt-route', { selected: selectedRouteIndex === route.index }]"
              @click="selectRoute(route.index)"
            >
              <div class="alt-top">
                <span
                  class="route-dot"
                  :style="{ background: ['#3b82f6','#f59e0b','#10b981'][route.index] }"
                />
                <div class="alt-header">
                  <div class="alt-label">{{ route.label }}</div>
                  <div class="alt-info">{{ route.distance }} · {{ route.duration }}</div>
                </div>
                <span v-if="selectedRouteIndex === route.index" class="check">✓</span>
              </div>
              <div
                v-if="selectedRouteIndex === route.index && (route.pros.length || route.cons.length)"
                class="pros-cons"
              >
                <div v-if="route.pros.length" class="pc-group">
                  <div v-for="p in route.pros" :key="p" class="pc-item pro">
                    <span class="pc-icon">✅</span> {{ p }}
                  </div>
                </div>
                <div v-if="route.cons.length" class="pc-group">
                  <div v-for="c in route.cons" :key="c" class="pc-item con">
                    <span class="pc-icon">⚠️</span> {{ c }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-if="instructions.length" class="instructions">
            <h3>🧭 Turn-by-turn</h3>
            <ul>
              <li v-for="(step, i) in instructions" :key="i">{{ step }}</li>
            </ul>
          </div>

        </div>
      </transition>

      <!-- Form Modal -->
<transition name="panel-slide">
  <div v-if="formPanelOpen" class="form-modal">

    <!-- X close button -->
    <button class="close-btn" @click="toggleForm">✕</button>

    <!-- Header -->
    <div class="form-header">
      <div class="form-tagline"></div>
      <h2 class="form-title">Employee Form</h2>
    </div>

    <!-- Form fields -->
    <div class="form-body">
      
      <!-- Row 1 -->
      <div class="form-row">
        <div class="form-group">
          <label>Employee Number</label>
          <a-input v-model:value="formData.employeeNumber" placeholder="Employee Number" />
        </div>
        <div class="form-group">
          <label>Employee Name</label>
          <a-input v-model:value="formData.employeeName" placeholder="Employee Name" />
        </div>
        <div class="form-group">
          <label>Branch</label>
          <a-input v-model:value="formData.branch" placeholder="Branch" />
        </div>
      </div>

      <!-- Row 2 -->
      <div class="form-row">
        <div class="form-group full-width">
          <label>Address</label>
          <a-input v-model:value="formData.address" placeholder="Address" />
        </div>
      </div>

      <!-- Row 3 - Distance -->
      <div class="form-row">
        <div class="form-group">
          <label>Distance (KM)</label>
          <a-input v-model:value="formData.distanceKm" placeholder="0.00" type="number" />
        </div>
        <div class="form-group">
          <label>Amount</label>
          <a-input v-model:value="formData.distanceAmount" placeholder="0.00" type="number" />
        </div>
      </div>

      <!-- Row 4 - PSO Distance -->
      <div class="form-row">
        <div class="form-group">
          <label>PSO</label>
          <a-input v-model:value="formData.pso" placeholder="Pso" />
        </div>
        <div class="form-group">
          <label>PSO Distance (KM)</label>
          <a-input v-model:value="formData.psoDistanceKm" placeholder="0.00" type="number" />
        </div>
        <div class="form-group">
          <label>PSO Amount</label>
          <a-input v-model:value="formData.psoDistanceAmount" placeholder="0.00" type="number" />
        </div>
      </div>

    </div>

    <!-- Submit button -->
    <div class="form-footer">
      <a-button type="primary" class="submit-btn" @click="submitForm">
        Enter
      </a-button>
    </div>

  </div>
</transition>

    </a-layout>
  </a-layout>
</template>

<style scoped>
/* ── Sidebar brand ── */
.sider-logo {
  height: 56px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  overflow: hidden;
  flex-shrink: 0;
}
.logo-icon { font-size: 20px; color: #3b82f6; flex-shrink: 0; }
.logo-text { font-size: 15px; font-weight: 600; color: #fff; white-space: nowrap; }

/* Notification */
.notif {
  position: absolute;
  top: 16px; left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  padding: 12px 18px;
  border-radius: 12px;
  font-size: 13px;
  max-width: 440px;
  text-align: center;
  line-height: 1.6;
  pointer-events: none;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
}
.notif.error   { background: #7f1d1d; color: #fca5a5; border: 1px solid #ef4444; }
.notif.warning { background: #78350f; color: #fde68a; border: 1px solid #f59e0b; }
.notif.success { background: #14532d; color: #86efac; border: 1px solid #22c55e; }
.notif-enter-active, .notif-leave-active { transition: all 0.3s ease; }
.notif-enter-from, .notif-leave-to { opacity: 0; transform: translateX(-50%) translateY(-10px); }

/* Search bar*/
.search-container {
  position: absolute;
  top: 16px; left: 16px;
  z-index: 5; width: 320px;
}
.search-box {
  display: flex; align-items: center; gap: 8px;
  background: #fff; border-radius: 12px;
  padding: 10px 14px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}
.search-icon { font-size: 15px; }
.search-input {
  flex: 1; border: none; outline: none;
  font-size: 14px; background: transparent; color: #1e1e2e;
}
.clear-btn {
  background: #f0f0f0; border: none; border-radius: 50%;
  width: 22px; height: 22px; cursor: pointer; color: #666;
  font-size: 12px; display: flex; align-items: center; justify-content: center;
}
.clear-btn:hover { background: #ddd; }
.search-results {
  background: #fff; border-radius: 12px; margin-top: 6px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15); overflow: hidden;
}
.search-result-item {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 14px; cursor: pointer;
  border-bottom: 1px solid #f0f0f0; transition: background 0.15s;
}
.search-result-item:last-child { border-bottom: none; }
.search-result-item:hover { background: #f8f8ff; }
.result-icon { font-size: 15px; margin-top: 2px; }
.result-name { font-size: 14px; font-weight: 600; color: #1e1e2e; }
.result-full { font-size: 12px; color: #888; margin-top: 2px; }

/* Navigation floating panel */
.nav-panel {
  position: absolute;
  top: 16px; right: 16px;
  width: 265px;
  max-height: calc(100% - 32px);
  overflow-y: auto;
  background: #1e1e2e;
  border-radius: 16px;
  padding: 18px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
  color: white;
}
.panel-slide-enter-active, .panel-slide-leave-active { transition: all 0.25s ease; }
.panel-slide-enter-from, .panel-slide-leave-to { opacity: 0; transform: translateX(20px); }

.panel-header { display: flex; justify-content: space-between; align-items: center; margin-right: 30px; }
.panel-header h2 { margin: 0; font-size: 16px; color: #fff; }

.reset-btn {
  background: #2a2a3d; border: 1px solid #444; color: #aaa;
  border-radius: 8px; padding: 4px 10px; font-size: 12px;
  cursor: pointer; transition: all 0.2s;
}
.reset-btn:hover { background: #ef4444; color: #fff; border-color: #ef4444; }

.section-label { font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: 1px; }

/* Mode buttons */
.mode-selector { display: flex; gap: 8px; }
.mode-btn {
  flex: 1;
  background: #2a2a3d; border: 2px solid transparent;
  border-radius: 10px; color: white;
  padding: 10px 6px; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; gap: 5px;
  transition: all 0.2s; position: relative;
}
.mode-btn:hover { background: #33334a; }
.mode-btn.active { border-color: #3b82f6; background: #1e3a5f; }
.mode-ant-icon { font-size: 18px; color: #aaa; }
.mode-btn.active .mode-ant-icon { color: #93c5fd; }
.mode-label { font-size: 11px; color: #aaa; }
.mode-btn.active .mode-label { color: #93c5fd; }
.active-dot {
  position: absolute; top: 5px; right: 5px;
  width: 6px; height: 6px; background: #3b82f6; border-radius: 50%;
}

/* Hints */
.hint-box {
  background: #2a2a3d; border-radius: 10px;
  padding: 12px; font-size: 12px; color: #aaa; text-align: center;
}
.mode-notice { font-size: 12px; border-radius: 8px; padding: 10px 12px; line-height: 1.6; }
.mode-notice.ground  { background: #1a2a1a; color: #aaa; }
.mode-notice.confirm { background: #2a2000; color: #fde68a; border: 1px solid #f59e0b; }
.green { color: #22c55e; font-weight: bold; }
.red   { color: #ef4444; font-weight: bold; }

/* Location cards */
.locations {
  background: #2a2a3d; border-radius: 10px;
  padding: 10px; display: flex; flex-direction: column;
}
.location-item { display: flex; align-items: flex-start; gap: 8px; }
.dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; margin-top: 4px; }
.green-dot { background: #22c55e; }
.red-dot   { background: #ef4444; }
.location-text { flex: 1; min-width: 0; }
.loc-label { font-size: 10px; color: #555; text-transform: uppercase; }
.loc-name  { font-size: 12px; color: #ddd; line-height: 1.4; word-break: break-word; }
.x-btn {
  margin-left: auto; background: none; border: none;
  color: #555; cursor: pointer; font-size: 12px;
  padding: 0 4px; transition: color 0.2s; flex-shrink: 0;
}
.x-btn:hover { color: #ef4444; }
.route-connector { width: 2px; height: 10px; background: #444; margin: 4px 0 4px 4px; }

/* Stats */
.stats { display: flex; flex-direction: column; gap: 8px; }
.stat {
  background: #2a2a3d; border-radius: 8px;
  padding: 10px 14px; display: flex; justify-content: space-between; align-items: center;
}
.lbl { font-size: 12px; color: #aaa; }
.val { font-size: 14px; font-weight: bold; }

/* Alternative routes */
.alternatives h3 { font-size: 12px; color: #aaa; margin: 0 0 8px; }
.alt-route {
  background: #2a2a3d; border: 2px solid transparent;
  border-radius: 12px; padding: 10px 12px;
  cursor: pointer; margin-bottom: 8px; transition: all 0.2s;
}
.alt-route:hover { background: #33334a; }
.alt-route.selected { border-color: #3b82f6; background: #1a2540; }
.alt-top { display: flex; align-items: center; gap: 10px; }
.route-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
.alt-header { flex: 1; }
.alt-label { font-size: 12px; font-weight: bold; color: #e2e8f0; }
.alt-info  { font-size: 11px; color: #888; margin-top: 2px; }
.check { font-size: 14px; color: #3b82f6; font-weight: bold; flex-shrink: 0; }

.pros-cons {
  margin-top: 10px; padding-top: 10px;
  border-top: 1px solid #333;
  display: flex; flex-direction: column; gap: 4px;
}
.pc-group { display: flex; flex-direction: column; gap: 4px; }
.pc-item  { display: flex; align-items: flex-start; gap: 6px; font-size: 11px; line-height: 1.5; }
.pc-item.pro { color: #86efac; }
.pc-item.con { color: #fde68a; }
.pc-icon { font-size: 11px; flex-shrink: 0; margin-top: 1px; }

/* Instructions */
.instructions h3 { font-size: 12px; color: #aaa; margin: 0 0 6px; }
.instructions ul { padding-left: 16px; margin: 0; font-size: 11px; color: #ddd; line-height: 1.9; }

.close-btn {
  position: absolute;
  top: 14px;
  right: 14px;
  background: #2a2a3d;
  border: 1px solid #444;
  color: #aaa;
  border-radius: 50%;
  width: 26px;
  height: 26px;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  z-index: 10;
}
.close-btn:hover {
  background: #ef4444;
  color: white;
  border-color: #ef4444;
}

.nav-panel {
  position: absolute;
}

/* Form Modal */
.form-modal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 560px;
  background: #1e1e2e;
  border-radius: 16px;
  padding: 24px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6);
  color: white;
}

.form-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding-bottom: 12px;
  border-bottom: 1px solid #2a2a3d;
}

.form-tagline {
  font-size: 11px;
  color: #888;
  font-style: italic;
  text-align: center;
}

.form-title {
  font-size: 18px;
  font-weight: 600;
  color: #fff;
  margin: 0;
}

.form-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-row {
  display: flex;
  gap: 12px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}

.form-group.full-width {
  flex: 1 1 100%;
}

.form-group label {
  font-size: 11px;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.form-footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 8px;
  border-top: 1px solid #2a2a3d;
}

.submit-btn {
  min-width: 100px;
}
</style>