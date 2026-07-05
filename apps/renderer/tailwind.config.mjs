import typography from "@tailwindcss/typography";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "var(--color-primary)",
        secondary: "var(--color-secondary)",
        accent: "var(--color-accent)",
      },
      fontFamily: {
        heading: "var(--font-heading)",
        body: "var(--font-body)",
      },
      // Wire typography plugin prose colors to brand tokens so RichContent
      // inherits the gym's color scheme instead of the default gray palette.
      typography: {
        DEFAULT: {
          css: {
            "--tw-prose-headings": "var(--color-primary)",
            "--tw-prose-body": "var(--color-secondary)",
            "--tw-prose-links": "var(--color-accent)",
            "--tw-prose-bold": "var(--color-primary)",
            "--tw-prose-counters": "var(--color-secondary)",
            "--tw-prose-bullets": "var(--color-accent)",
          },
        },
      },
    },
  },
  plugins: [typography],
};
