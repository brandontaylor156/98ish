// Brandon's other web apps, each opened as its own 98ish program (a window around the
// live site). Add a project here and it appears on the desktop and under Start >
// Programs > My Projects.

export const PROJECTS = [
  {
    name: "Baseline Today",
    url: "https://baseline-today.vercel.app",
    icon: "/assets/program_icons/baseline.svg",
    about: "ATP and WTA singles rankings, recent results, player profiles and season records.",
  },
  {
    name: "Job Market Radar",
    url: "https://job-market-radar-sigma.vercel.app",
    icon: "/assets/program_icons/jobradar.svg",
    about: "Which US industries are rising and sinking, from job postings, hiring and employment data.",
  },
  {
    name: "One Closet",
    url: "https://one-closet.vercel.app",
    icon: "/assets/program_icons/onecloset.svg",
    about: "Everything you love from every store, in one place.",
    // its sign-in uses cookies, which browsers often block inside another site's window
    signIn: true,
  },
]
