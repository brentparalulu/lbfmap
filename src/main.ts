// import { createApp } from 'vue'
// import App from './App.vue'

// // Ant Design Vue
// import Antd from 'ant-design-vue'
// import 'ant-design-vue/dist/reset.css'

// // Mapbox GL CSS (also imported in Map.vue but safe to have here too)
// import 'mapbox-gl/dist/mapbox-gl.css'

// const app = createApp(App)
// app.use(Antd)
// app.mount('#app')

import { createApp } from 'vue'
import App from './App.vue'

import Antd from 'ant-design-vue'
import 'ant-design-vue/dist/reset.css'
import 'mapbox-gl/dist/mapbox-gl.css'


const app = createApp(App)
app.use(Antd)
app.mount('#app')