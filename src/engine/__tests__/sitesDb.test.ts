import { describe, expect, test } from "bun:test";
import {
  buildProbeUrl,
  buildProfileUrl,
  filterSites,
  isUsernameIllegal,
} from "../sitesDb";
import type { MaigretDb } from "../types";

const db: MaigretDb = {
  sites: {
    Zebra: {
      url: "https://z.example/{username}",
      urlMain: "https://z.example",
      alexaRank: 500,
    },
    Alpha: {
      url: "https://a.example/{username}",
      urlMain: "https://a.example",
      alexaRank: 10,
    },
    Unranked: {
      url: "https://u.example/{username}",
      urlMain: "https://u.example",
    },
    Disabled: {
      url: "https://d.example/{username}",
      urlMain: "https://d.example",
      disabled: true,
      alexaRank: 1,
    },
    Photo: {
      url: "https://p.example/{username}",
      urlMain: "https://p.example",
      alexaRank: 5,
      tags: ["photo"],
    },
  },
};

describe("filterSites", () => {
  test("skips disabled and sorts by rank", () => {
    const names = filterSites(db).map(([n]) => n);
    expect(names).toEqual(["Photo", "Alpha", "Zebra", "Unranked"]);
  });

  test("tag filter is case-insensitive", () => {
    expect(filterSites(db, { tags: ["PHOTO"] }).map(([n]) => n)).toEqual([
      "Photo",
    ]);
  });

  test("maxSites caps the list", () => {
    expect(filterSites(db, { maxSites: 2 })).toHaveLength(2);
  });
});

describe("url builders", () => {
  test("urlProbe wins for probing, url for display", () => {
    const site = {
      url: "https://x.example/{username}",
      urlMain: "https://x.example",
      urlProbe: "https://api.x.example/users/{username}",
    };
    expect(buildProbeUrl(site, "bob")).toBe("https://api.x.example/users/bob");
    expect(buildProfileUrl(site, "bob")).toBe("https://x.example/bob");
  });

  test("regexCheck rejects illegal usernames", () => {
    const site = {
      url: "https://g.example/{username}",
      urlMain: "https://g.example",
      regexCheck: "^[a-z0-9]{1,10}$",
    };
    expect(isUsernameIllegal(site, "bob")).toBe(false);
    expect(isUsernameIllegal(site, "Bob!")).toBe(true);
  });
});
