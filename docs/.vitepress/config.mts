import { defineConfig } from 'vitepress'

export default defineConfig({
	title: 'conex',
	description: 'Network inventory for MSPs.',
	// Served from https://serkonda7.github.io/conex/
	base: '/conex/',
	cleanUrls: true,
	lastUpdated: true,
	themeConfig: {
		nav: [{ text: 'Guide', link: '/racks' }],
		sidebar: [
			{
				text: 'Inventory',
				items: [{ text: 'Racks', link: '/racks' }],
			},
			{
				text: 'Integrations',
				items: [
					{ text: 'Consistency Checks', link: '/integrations/consistency' },
					{ text: 'AGFEO Dashboard', link: '/integrations/agfeo' },
				],
			},
		],
		socialLinks: [{ icon: 'github', link: 'https://github.com/serkonda7/conex' }],
		search: { provider: 'local' },
	},
})
