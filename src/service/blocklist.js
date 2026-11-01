/**
 * blocklist.js
 *
 * Words the output filter always blocks: slurs and strong profanity. Stored as salted
 * SHA-256 hashes of the lowercase word, so the words themselves never sit in the repo
 * (docs/pipeline-contract.md, "Slurs are deliberately not in the repo").
 *
 * To add a word: `node scripts/blocklist-hash.js <word> <category>` prints the entry.
 * Add plural or spelling variants as their own entries; the filter already undoes
 * leetspeak (`n00b`), repeated letters and a trailing "s".
 */

export const BLOCKLIST_SALT = "witc-blocklist-v1:";

/** [sha256(BLOCKLIST_SALT + word), category] */
export const BLOCKLIST = Object.freeze([
  ["0867284498eb2df1120c7c7a5c960982bf877c9285eda02fe5c67ef0b5939ea7", "slur"],
  ["09efc92a868aedb60ad79f8649f450c3c298d71e7a312e3a1ee1f3ceedb4d2f2", "slur"],
  ["25c1a6ad9877888fdd261dfdb27763ea064098f5b08a806ce89cc893a268e47d", "slur"],
  ["28bf883f62b15c562584f03a55e68ac5f0e29abee0cb4bd9a4541e856dd2f6f6", "slur"],
  ["2c2838e73e52d09be44985899264438c6c01fafcbe2cbdc9e9cf17a5a00ce921", "slur"],
  ["34abe5ddf219a1fa15b9777a17bb63a9228a6674b289585fe14c2ee4f53f5365", "slur"],
  ["4352d459c017c66ebd4ab4b30b1f04e111a964eb59cc3e41c27b3294af7ac830", "slur"],
  ["4a87e0565a50fc0aa78dc7d83840284357894a63f8927bbc4c49e758626bf581", "profanity"],
  ["4b3c2042edf3ba5f319c88326244d62f283912b6ba15b66d9ae43fbdd08797b8", "slur"],
  ["5d1f919f22c551c3913f995d3fb7fc066fd9108cc4a143e60aba392c9a31dc0f", "profanity"],
  ["681344f15f72aec6f5cc453b7dd6c04e8591dc893d032513a29154b4d76a25b7", "slur"],
  ["6d48075d0fcf80f4a1f3ad8ee0637a7eca1c3e2ed64e89a195385841ca5b3316", "slur"],
  ["75fe1c1b275735ffd64f0098522664f1164ef84de8e12c3009ce11c3bc3fc20c", "slur"],
  ["7601f91dd13ff3d6d734d91a7bbe29ef3b8141f415c7e24b4f5595b4cde412da", "profanity"],
  ["7e21ccac4de495bbc9a18ca9bcf1124c9ff2003f040e837904028e0b25f8324b", "slur"],
  ["81758080d7a2c9370d80c53a96d297517a16297ace0d491ec95f38f429b3f04c", "slur"],
  ["8b2a0fdef823db124f2891fdad6621cbb270e64e5ae1a61fbaa068d8ca1a1e1d", "slur"],
  ["8fcb2aa519750c2a9952ff37949cbfd823fa6ec8cffc84fec1b76598c2cfaa4d", "slur"],
  ["a4b258774835933c10f0ffecc1d4f4616c16bb9b29cd063bcd140794c6996768", "profanity"],
  ["a9b54e66102ec54090ce636eda08775ac66b6ac0b4806d9fcd4e6378b08c976a", "slur"],
  ["b088972adfadd02291f0fbf318251a16aed6fad7d89167aaa795e80a867edf43", "slur"],
  ["b36547f45dacde999649010a4ebb80fd750764b67c95f7e9af796352cfadf621", "profanity"],
  ["b76bfe23dcc3b4aff25906168f59ca009fb964fbb98f54c307d1af9a57e97b7f", "slur"],
  ["b7be287ee34780232f9a2c29e3e879c93d6d5d1a14336a4abe064793411b236f", "slur"],
  ["c500c582c2dd00c9bc7bf9a0d44320005569ab0c10a071c03c8981492d8cc5d6", "slur"],
  ["d52dbeee50d5ab7932c63fbbf235ff8580f5c05cb99150f6d1088eff7509eae6", "slur"],
  ["d81803f4f4345832916433117079cba6b4d12e1ec5fe5af2562eb0ed2b0c1fef", "profanity"],
  ["e73f1be5e5164c72ce1c1d07fe1151c76c927d238e81d6e8a56f9ca807712e53", "slur"],
  ["e80f8bf10b5893f2fed73b3362be8f4afa2afedd6abb7671b6e3ca4f9f1d0315", "slur"],
  ["f5108fbe03ce8ee1939e2c31ca0ee7110bda0ba705c7664a87a36e8d985e2fea", "profanity"],
  ["fbb20b1410bec51ba656b78d76babf841e2aa06033d68180bb9b2ba38bbd84e3", "profanity"],
]);
