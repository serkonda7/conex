import { render } from 'solid-js/web'

import App from './App'
import './css/styles.css'

const root = document.querySelector('#root')

// biome-ignore lint/style/noNonNullAssertion: we know it exists
render(() => <App />, root!)
