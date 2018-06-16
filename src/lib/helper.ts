import {
  settingsDefault,
  windefSet,
  _UNICODE_HOLDER,
  _WIN64_HOLDER,
} from './config'
import {
  DataTypes,
  FnParam,
  LoadSettings,
  MacroDef,
  MacroMap,
} from './ffi.model'


// convert macro variable of windef
export function parse_windef(windefObj: DataTypes, macroMap: MacroMap, settings?: LoadSettings): DataTypes {
  const ww = clone_filter_windef(windefObj) // output without macroMap
  const macroSrc = prepare_macro(macroMap, settings)

  return prepare_windef_ref(ww, macroSrc)
}


/**
 * convert typeof array of param to string
 * such like ['_WIN64_HOLDER_', 'int64', 'int32'], no changed returning when string
 */
function parse_param_placeholder(param: FnParam | MacroDef, settings?: LoadSettings): FnParam {
  if (typeof param === 'string') {
    return param
  }
  else if (!param) {
    throw new Error('parse_param_placeholder(ps, settings) value of ps invalid')
  }
  else if (!Array.isArray(param) || param.length !== 3) {
    throw new Error('parse_param_placeholder(ps, settings) value of ps must Array and has THREE elements')
  }

  const st = parse_settings(settings)
  let p: FnParam = ''

  switch (param[0]) {
    case _WIN64_HOLDER:
      p = parse_placeholder_arch(param, <boolean> st._WIN64)
      break
    case _UNICODE_HOLDER:
      p = parse_placeholder_unicode(param, <boolean> st._UNICODE)
      break
    default:
      throw new Error('the value of param placeholder invlaid:' + param[0])
  }

  return p
}


// convert param like ['_WIN64_HOLDER_', 'int64', 'int32] to 'int64' or 'int32'
function parse_placeholder_arch(param: FnParam | MacroDef, _WIN64: boolean): FnParam {
  if (typeof param === 'string') {
    return param
  }
  else if (!param || param.length !== 3) {
    throw new Error('_WIN64 macro should be Array and has 3 items')
  }

  return _WIN64 ? param[1] : param[2]
}

// convert param like ['_UNICODE_HOLDER_', 'uint16*', 'uint8*'] to 'uint16*' or 'uint8*'
function parse_placeholder_unicode(param: FnParam | MacroDef, _UNICODE: boolean): FnParam {
  if (typeof param === 'string') {
    return param
  }
  else if (!param || param.length !== 3) {
    throw new Error('_UNICODE macro should be Array and has 3 items')
  }
  return _UNICODE ? param[1] : param[2]
}


/**
 * parse ['_WIN64_HOLDER', 'int64*', 'int32*'] to 'int64*' or 'int32'
 * or ['_UNICODE_HOLDER_', 'uint16*', 'uint8*'] to 'uint16*' or 'uint8*'
 */
function prepare_macro(macroMap: MacroMap, settings?: LoadSettings): Map<string, FnParam> {
  const ret = <Map<string, FnParam>> new Map()

  // v string|array
  for (const [k, v] of macroMap.entries()) {
    ret.set(k, parse_param_placeholder(v, settings))
  }
  return ret
}


/**
 * parse const HANDLE = 'PVOID' to the realy FFIParam (like 'uint32*')
 * macroMap <['PVOID', 'uint32*'], ...>
 */
function prepare_windef_ref(ww: DataTypes, macroSrc: Map<string, string>): DataTypes {
  const ret = <DataTypes> {}
  const map = <Map<string, string>> new Map()

  // first loop paser keys which exists in macroSrc
  for (const x of Object.keys(ww)) {
    /* istanbul ignore next */
    if (map.has(x)) {
      continue
    }
    if (macroSrc.has(x)) {  // PVOID:_WIN64_HOLDER -> PVOID:'uint64*'
      const vv = macroSrc.get(x)

      if (vv) {
        validDataDef(vv, windefSet)
        map.set(x, vv)
      }
      else {
        throw new Error(`Value of macroSrc item "${x}" blank`)
      }
    }
    else {
      continue  // not throw error
    }
  }
  // 2nd loop paser key , maybe value refer other key
  for (const [k, v] of Object.entries(ww)) {
    /* istanbul ignore next */
    if (map.has(k)) {
      continue
    }
    const value = retrieve_ref_value(ww, k, map)
    value && windefSet.has(value) && map.set(k, value)

    // if (typeof v === 'string') {
    //   if (windefSet.has(v)) {
    //     map.set(k, v)
    //   }
    //   else {
    //     const value = lookupRef(v, ww, macroSrc)

    //     // tslint:disable-next-line
    //     if (typeof value === 'string' && value) {
    //       map.set(k, v)
    //     }
    //     else {
    //       map.set(k, v) // maybe invalid for windefSet, will validateWinData() later
    //     }
    //   }
    // }
    // else {
    //   throw new Error(`prepare_windef_ref() missing entry for k/v: ${k}/${v}`)
    // }
  }

  map.forEach((v, k) => {
    ret[k] = v
  })

  return ret
}


function clone_filter_windef(windef: DataTypes): DataTypes {
  const ret = <DataTypes> {}

  for (const x of Object.keys(windef)) {
    if (typeof windef[x] === 'string') {
      Object.defineProperty(ret, <string> x, {
        value: <FnParam> windef[x],
        writable: true,
        enumerable: true,
        configurable: true,
      })
    }
    else {
      throw new Error(`typeof value of ${x} NOT string`)
    }
  }

  return ret
}

function parse_settings(settings?: LoadSettings): LoadSettings {
  const st: LoadSettings = { ...settingsDefault }

  if (typeof settings !== 'undefined' && settings && Object.keys(settings).length) {
    Object.assign(st, settings)
  }
  return st
}

function retrieve_ref_value(ww: DataTypes, key: string, srcMap: Map<string, string>): string {
  const mapValue = srcMap.get(key)

  if (mapValue) {
    return mapValue
  }

  if (typeof ww[key] === 'undefined') {
    return ''
  }
  const value = ww[key]

  /* istanbul ignore next */
  if (! value) {
    return ''
  }
  // check whether ww has element value as key
  const refValue = retrieve_ref_value(ww, value, srcMap)

  return refValue ? refValue : value
}

function lookupRef(key: string, ww: DataTypes, macroSrc: Map<string, string>): string {
  let ret = _lookupRef(key, ww, macroSrc)

  if (! ret) {
    return ''
  }

  for (let i = 0, len = 3; i < len; i++) {
    const tmp = _lookupRef(ret, ww, macroSrc)

    if (tmp) {
      ret = tmp
    }
    else {
      break
    }
  }

  return ret
}
function _lookupRef(key: string, ww: DataTypes, macroSrc: Map<string, string>): string {
  if (macroSrc.has(key)) {
    return <string> macroSrc.get(key)
  }
  let ret = ''

  // not valid FFIParam such 'int/uint...', like HMODULE: 'HANDLE'
  if (typeof ww[key] === 'string') {
    // parse HANDLE: 'PVOID' , PVOID already parsed
    ret = <string> ww[key]

    if (ret) {
      if (macroSrc.has(ret)) {  //  HANDLE:PVOID, macroSrc has PVOID
        return <string> macroSrc.get(ret)
      }
    }
    return ret
  }

  return ret
}


// valid parsed value exists in windefSet
export function validDataDef(str: string, srcSet: Set<string>): void {
  if (! str || typeof str !== 'string') {
    throw new Error(`value of param invalid: ${str}`)
  }
  if (! srcSet.has(str)) {
    throw new Error(`conifig.windefSet not contains element of ${str}`)
  }
}
