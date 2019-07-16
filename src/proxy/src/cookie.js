import {Database} from './database.js'


function Cookie() {
  this.name = ''
  this.value = ''
  this.domain = ''
  this.hostOnly = false
  this.path = ''
  this.expires = NaN
  this.isExpired = false
  this.secure = false
  this.httpOnly = false
  this.sameSite = ''
}

/**
 * @param {Cookie} src 
 * @param {Cookie} dst 
 */
function copy(dst, src) {
  dst.name = src.name
  dst.value = src.value
  dst.domain = src.domain
  dst.hostOnly = src.hostOnly
  dst.path = src.path
  dst.expires = src.expires
  dst.isExpired = src.isExpired
  dst.secure = src.secure
  dst.httpOnly = src.httpOnly
  dst.sameSite = src.sameSite
}


/**
 * @param {string} cookiePath 
 * @param {string} urlPath 
 */
function isSubPath(cookiePath, urlPath) {
  if (urlPath === cookiePath) {
    return true
  }
  if (!cookiePath.endsWith('/')) {
    cookiePath += '/'
  }
  return urlPath.startsWith(cookiePath)
}


/**
 * @param {string} cookieDomain 
 * @param {string} urlDomain 
 */
function isSubDomain(cookieDomain, urlDomain) {
  return urlDomain === cookieDomain ||
    urlDomain.endsWith('.' + cookieDomain)
}


/**
 * @param {Cookie} item 
 * @param {number} now
 */
function isExpire(item, now) {
  const v = item.expires
  return !isNaN(v) && v < now
}


class CookieDomainNode {
  constructor() {
    /** @type {Cookie[]} */
    this.items = null

    /** @type {Object<string, CookieDomainNode>} */
    this.children = {}
  }

  /**
   * @param {string} name 
   */
  nextChild(name) {
    return this.children[name] || (
      this.children[name] = new CookieDomainNode
    )
  }

  /**
   * @param {string} name 
   */
  getChild(name) {
    return this.children[name]
  }

  /**
   * @param {Cookie} cookie 
   */
  addCookie(cookie) {
    if (this.items) {
      this.items.push(cookie)
    } else {
      this.items = [cookie]
    }
  }
}

/** @type {Map<string, Cookie>} */
const mIdCookieMap = new Map()

const mCookieNodeRoot = new CookieDomainNode()



export function getNonHttpOnlyItems() {
  const ret = []
  for (const item of mIdCookieMap.values()) {
    if (!item.httpOnly) {
      ret.push(item)
    }
  }
  return ret
}


/**
 * @param {string} str 
 * @param {URL} urlObj 
 */
export function parse(str, urlObj) {
  const item = new Cookie()
  const arr = str.split(';')
  const now = Date.now()

  for (let i = 0; i < arr.length; i++) {
    let key, val
    const s = arr[i].trim()
    const p = s.indexOf('=')

    if (p !== -1) {
      key = s.substr(0, p)
      val = s.substr(p + 1)
    } else {
      //
      // cookie = 's; secure; httponly'
      //  0: { key: '', val: 's' }
      //  1: { key: 'secure', val: '' }
      //  2: { key: 'httponly', val: '' }
      //
      key = (i === 0) ? '' : s
      val = (i === 0) ? s : ''
    }

    if (i === 0) {
      item.name = key
      item.value = val
      continue
    }

    switch (key.toLocaleLowerCase()) {
    case 'expires':
      if (isNaN(item.expires)) {
        item.expires = Date.parse(val)
      }
      break
    case 'domain':
      if (val[0] === '.') {
        val = val.substr(1)
      }
      item.domain = val
      break
    case 'path':
      item.path = val
      break
    case 'httponly':
      item.httpOnly = true
      break
    case 'secure':
      item.secure = true
      break
    case 'max-age':
      item.expires = now + (+val) * 1000
      break
    case 'samesite':
      item.sameSite = val
      break
    }
  }

  if (isExpire(item, now)) {
    item.isExpired = true
  }

  // https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Headers/Set-Cookie
  if (item.name.startsWith('__Secure-')) {
    if (!(
      urlObj.protocol === 'https:' &&
      item.secure
    )) {
      return
    }
  }
  if (item.name.startsWith('__Host-')) {
    if (!(
      urlObj.protocol === 'https:' &&
      item.secure &&
      item.domain === '' &&
      item.path === '/'
    )) {
      return
    }
  }

  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie#Compatibility_notes
  if (item.secure && urlObj.protocol === 'http:') {
    return
  }

  // check hostname
  const domain = urlObj.hostname

  if (item.domain) {
    if (!isSubDomain(item.domain, domain)) {
      console.warn('[jsproxy] invalid cookie domain! `%s` ⊄ `%s`',
        item.domain, domain)
      return
    }
  } else {
    item.domain = domain
    item.hostOnly = true
  }

  // check pathname
  const path = urlObj.pathname

  if (item.path) {
    if (!isSubPath(item.path, path)) {
      console.warn('[jsproxy] invalid cookie path! `%s` ⊄ `%s`',
        item.path, path)
      return
    }
  } else {
    item.path = path
  }

  set(item)
  return item
}


/**
 * @param {Cookie} item
 */
function getCookieId(item) {
  return (item.secure ? ';' : '') +
    item.name + ';' +
    item.domain +
    item.path
}


/**
 * @param {Cookie} item
 */
export function set(item) {
  // console.log('set:', item)
  const id = getCookieId(item)
  const matched = mIdCookieMap.get(id)

  if (matched) {
    if (item.isExpired) {
      // delete
      mIdCookieMap.delete(id)
      matched.isExpired = true
    } else {
      copy(matched, item)
    }
  } else {
    // create
    const labels = item.domain.split('.')
    let labelPos = labels.length
    let node = mCookieNodeRoot
    do {
      node = node.nextChild(labels[--labelPos])
    } while (labelPos !== 0)
  
    node.addCookie(item)
    mIdCookieMap.set(id, item)
  }
}


/**
 * @param {URL} urlObj 
 */
export function concat(urlObj) {
  const ret = []
  const now = Date.now()
  const domain = urlObj.hostname
  const path = urlObj.pathname
  const isHttps = (urlObj.protocol === 'https:')


  const labels = domain.split('.')
  let labelPos = labels.length
  let node = mCookieNodeRoot
  do {
    node = node.getChild(labels[--labelPos])
    if (!node) {
      break
    }
    const items = node.items
    if (!items) {
      continue
    }
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      // https url | secure flag | carry
      //   ✔       |   ✔         |   ✔
      //   ✔       |   ✘         |   ✔
      //   ✘       |   ✘         |   ✔
      //   ✘       |   ✔         |   ✘
      if (!isHttps && item.secure) {
        break
      }
      // HostOnly Cookie 需匹配完整域名
      if (item.hostOnly && labelPos !== 0) {
        break
      }
      if (!isSubPath(item.path, path)) {
        break
      }
      if (isExpire(item, now)) {
        item.isExpired = true
        break
      }
      // TODO: same site

      let str = item.value
      if (item.name) {
        str = item.name + '=' + str
      }
      ret.push(str)
    }
  } while (labelPos !== 0)

  return ret.join('; ')
}
