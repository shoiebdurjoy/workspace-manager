import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
	darkMode: ["class"],
	content: [
		"./pages/**/*.{ts,tsx}",
		"./components/**/*.{ts,tsx}",
		"./app/**/*.{ts,tsx}",
		"./src/**/*.{ts,tsx}",
	],
	prefix: "",
	theme: {
		container: {
			center: true,
			padding: '2rem',
			screens: {
				'2xl': '1400px'
			}
		},
		extend: {
			colors: {
				border: 'hsl(var(--border))',
				input: 'hsl(var(--input))',
				ring: 'hsl(var(--ring))',
				background: 'hsl(var(--background))',
				foreground: 'hsl(var(--foreground))',
				primary: {
					DEFAULT: 'hsl(var(--primary))',
					foreground: 'hsl(var(--primary-foreground))'
				},
				secondary: {
					DEFAULT: 'hsl(var(--secondary))',
					foreground: 'hsl(var(--secondary-foreground))'
				},
				destructive: {
					DEFAULT: 'hsl(var(--destructive))',
					foreground: 'hsl(var(--destructive-foreground))'
				},
				muted: {
					DEFAULT: 'hsl(var(--muted))',
					foreground: 'hsl(var(--muted-foreground))'
				},
				accent: {
					DEFAULT: 'hsl(var(--accent))',
					foreground: 'hsl(var(--accent-foreground))'
				},
				popover: {
					DEFAULT: 'hsl(var(--popover))',
					foreground: 'hsl(var(--popover-foreground))'
				},
				card: {
					DEFAULT: 'hsl(var(--card))',
					foreground: 'hsl(var(--card-foreground))'
				},
				sidebar: {
					DEFAULT: 'hsl(var(--sidebar-background))',
					foreground: 'hsl(var(--sidebar-foreground))',
					primary: 'hsl(var(--sidebar-primary))',
					'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
					accent: 'hsl(var(--sidebar-accent))',
					'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
					border: 'hsl(var(--sidebar-border))',
					ring: 'hsl(var(--sidebar-ring))'
				},
				tbb: {
					50: '#f6f2fd',
					100: '#ede4fc',
					200: '#dcc9f9',
					300: '#c3a2f4',
					400: '#a573ec',
					500: '#8b48e3',
					600: '#7b2cbf',
					700: '#6920a4',
					800: '#581c87',
					900: '#49196e',
					950: '#2c0947',
				},
				status: {
					backlog: 'hsl(var(--status-backlog, 220 14% 60%))',
					progress: 'hsl(var(--status-in-progress, 217 91% 60%))',
					edit: 'hsl(var(--status-in-edit, 268 82% 56%))',
					review: 'hsl(var(--status-qc-review, 38 92% 50%))',
					revision: 'hsl(var(--status-revision, 12 85% 58%))',
					rtd: 'hsl(var(--status-qc-approved, 158 64% 45%))',
					delivered: 'hsl(var(--status-delivered, 174 72% 40%))',
				},
				priority: {
					urgent: 'hsl(var(--priority-urgent, 0 84% 60%))',
					high: 'hsl(var(--priority-high, 25 95% 53%))',
					normal: 'hsl(var(--priority-normal, 217 91% 60%))',
					low: 'hsl(var(--priority-low, 220 9% 46%))',
				},
				workwise: {
					'50': '#f0f9ff',
					'100': '#e0f2fe',
					'200': '#b9e6fe',
					'300': '#7cd2fd',
					'400': '#36bffa',
					'500': '#0ca4eb',
					'600': '#0085c9',
					'700': '#026aa3',
					'800': '#065986',
					'900': '#0c4a6e',
					'950': '#082f49',
				},
			},
			borderRadius: {
				lg: 'var(--radius)',
				md: 'calc(var(--radius) - 2px)',
				sm: 'calc(var(--radius) - 4px)'
			},
			keyframes: {
				'accordion-down': {
					from: {
						height: '0'
					},
					to: {
						height: 'var(--radix-accordion-content-height)'
					}
				},
				'accordion-up': {
					from: {
						height: 'var(--radix-accordion-content-height)'
					},
					to: {
						height: '0'
					}
				}
			},
			animation: {
				'accordion-down': 'accordion-down 0.2s ease-out',
				'accordion-up': 'accordion-up 0.2s ease-out'
			}
		}
	},
	plugins: [tailwindcssAnimate],
} satisfies Config;
