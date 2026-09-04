import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import '../shared/styles/theme.css'

createApp(App).use(createPinia()).mount('#app')
