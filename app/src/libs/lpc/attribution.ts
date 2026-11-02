/** Link only recognized licence identifiers; original and custom terms retain their authored text. */
export const lpcLicenseUrl = (license: string): string | undefined => {
  if (/^CC0(?:[ -]1\.0)?$/.test(license))
    return "https://creativecommons.org/publicdomain/zero/1.0/";
  if (/^OGA-BY[ -]3\.0\+?$/.test(license))
    return "https://static.opengameart.org/OGA-BY-3.0.txt";
  const creativeCommons = /^CC-BY(-SA)?[ -](3\.0|4\.0)\+?$/.exec(license);
  if (creativeCommons)
    return `https://creativecommons.org/licenses/${creativeCommons[1] ? "by-sa" : "by"}/${creativeCommons[2]}/`;
  return undefined;
};
