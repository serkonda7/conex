import { render } from 'solid-js/web'

import App from './app/App'
import '@serkonda7/solid-components/styles.css'
import './css/styles.css'

const root = document.querySelector('#root')
if (root === null) {
	throw new Error('Missing #root element')
}

render(() => <App />, root)
