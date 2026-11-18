export type SiteConfig = typeof siteConfig;

export const siteConfig = {
  name: "HExplorer",
  description: "Index, search and de-duplicate files across data folders",
  mainNav: [
    {
      title: "Home",
      href: "/",
    },
    {
      title: "Folders",
      href: "/folders",
    },
    {
      title: "Remotes",
      href: "/remotes",
    },
    {
      title: "Files",
      href: "/files",
    },
    {
      title: "Duplicates",
      href: "/duplicates",
    },
    {
      title: "Backups",
      href: "/backups",
    },
    {
      title: "Settings",
      href: "/settings",
    },
  ],
  links: {
    twitter: "https://twitter.com/hpolla",
    github: "https://github.com/hareeshbabu82ns/hexplorer",
    docs: "https://hexplorer.local.terabits.io/",
  },
};
