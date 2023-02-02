import * as dayjs from 'dayjs';

import { format_minutes } from 'utils';
import { fluxos_version_desc, fluxos_version_string, fluxos_version_desc_parse } from 'main/flux_version';

import { FLUXNODE_INFO_API_MODE, FLUXNODE_INFO_API_URL } from 'app-buildinfo';

import {
  CC_BLOCK_REWARD,
  CC_FLUX_REWARD_CUMULUS,
  CC_FLUX_REWARD_NIMBUS,
  CC_FLUX_REWARD_STRATUS,
  CC_FLUX_REWARD_FRACTUS,
  CC_PA_REWARD,
  CC_COLLATERAL_CUMULUS,
  CC_COLLATERAL_NIMBUS,
  CC_COLLATERAL_STRATUS,
  CC_COLLATERAL_FRACTUS
} from 'content/index';

const API_FLUX_NODES_ALL_URL = 'https://explorer.runonflux.io/api/status?q=getFluxNodes';
const API_FLUX_NODE_URL = 'https://api.runonflux.io/daemon/viewdeterministiczelnodelist?filter=';
const API_DOS_LIST = 'https://api.runonflux.io/daemon/getdoslist';
const API_FRACTUS_LIST = 'https://stats.runonflux.io/fluxinfo/benchmark.bench.thunder,benchmark.bench.totalstorage';

const API_NODE_INFO_ENDPOINT = '/flux/info';
const API_FLUX_APPLIST_ENDPOINT = '/apps/installedapps';
const API_FLUX_UPTIME_ENDPOINT = '/flux/uptime';

const FLUX_PER_DAY = (24 * 60) / 2; /* 1 flux every 2 minutes */

const CLC_NETWORK_CUMULUS_PER_DAY = FLUX_PER_DAY * ((CC_BLOCK_REWARD * CC_FLUX_REWARD_CUMULUS) / 100.0);
const CLC_NETWORK_NIMBUS_PER_DAY = FLUX_PER_DAY * ((CC_BLOCK_REWARD * CC_FLUX_REWARD_NIMBUS) / 100.0);
const CLC_NETWORK_STRATUS_PER_DAY = FLUX_PER_DAY * ((CC_BLOCK_REWARD * CC_FLUX_REWARD_STRATUS) / 100.0);
const CLC_NETWORK_FRACTUS_PER_DAY = FLUX_PER_DAY * ((CC_BLOCK_REWARD * CC_FLUX_REWARD_FRACTUS) / 100.0);

/* ======= global stats ======= */

export function tier_global_projections() {
  return {
    pay_frequency: 0 /* in minutes, display in days and hrs */,
    payment_amount: 0,
    pa_amount: 0,
    apy: 0
  };
}

export function create_global_store() {
  return {
    flux_price_usd: 0,
    node_count: {
      cumulus: 0,
      nimbus: 0,
      stratus: 0,
      fractus: 0,
      total: 0
    },
    reward_projections: {
      cumulus: tier_global_projections(),
      nimbus: tier_global_projections(),
      stratus: tier_global_projections(),
      fractus: tier_global_projections()
    },
    wallet_amount_flux: 0,
    fluxos_latest_version: fluxos_version_desc(0, 0, 0),
    bench_latest_version: fluxos_version_desc(0, 0, 0),
    current_block_height: 0,
    in_rich_list: false,
    total_donations: 0
  };
}

function fill_tier_g_projection(projectionTargetObj, nodeCount, networkFluxPerDay, collateral) {
  // pay freq = node_count * 2 minutes
  projectionTargetObj.pay_frequency = nodeCount * 2;

  /* ---- */

  const rewardPerPerson = networkFluxPerDay / nodeCount;
  projectionTargetObj.payment_amount = rewardPerPerson;

  /* ---- */

  const pa_amount = (rewardPerPerson * CC_PA_REWARD) / 100.0;
  projectionTargetObj.pa_amount = pa_amount;

  projectionTargetObj.apy = 100 * (((rewardPerPerson + pa_amount) * 365) / collateral);
}

function fill_tier_g_projection_fractus(projectionTargetObj, nodeCount, networkFluxPerDay, collateral, percentage = 15) {
  // pay freq = node_count * 2 minutes
  projectionTargetObj.pay_frequency = nodeCount * 2;

  /* ---- */
  const rewardPerPerson = networkFluxPerDay / nodeCount;
  projectionTargetObj.payment_amount = rewardPerPerson * 1.15; // 15% Native flux

  /* ---- */
  const pa_amount = (rewardPerPerson * CC_PA_REWARD) / 100.0;
  projectionTargetObj.pa_amount = pa_amount;

  projectionTargetObj.apy = 100 * (((rewardPerPerson * 1.15 + pa_amount) * 365) / collateral);
}

function fill_rewards(gstore) {
  fill_tier_g_projection(
    gstore.reward_projections.cumulus,
    gstore.node_count.cumulus,
    CLC_NETWORK_CUMULUS_PER_DAY,
    CC_COLLATERAL_CUMULUS
  );
  fill_tier_g_projection(
    gstore.reward_projections.nimbus,
    gstore.node_count.nimbus,
    CLC_NETWORK_NIMBUS_PER_DAY,
    CC_COLLATERAL_NIMBUS
  );
  fill_tier_g_projection(
    gstore.reward_projections.stratus,
    gstore.node_count.stratus,
    CLC_NETWORK_STRATUS_PER_DAY,
    CC_COLLATERAL_STRATUS
  );
  fill_tier_g_projection_fractus(
    gstore.reward_projections.fractus,
    gstore.node_count.cumulus,
    CLC_NETWORK_FRACTUS_PER_DAY,
    CC_COLLATERAL_FRACTUS,
  );
}

async function query_donate_transactions_all_pages() {
  const url = 'https://explorer.runonflux.io/api/txs?address=' + window.gContent.ADDRESS_FLUX;
  const firstPage = await fetch(url).then((res) => res.json());
  const { pagesTotal } = firstPage;
  const array = pagesTotal <= 1 ? [] : new Array(pagesTotal - 1).fill(0).map((_v, i) => i + 1);
  const results = await Promise.all(array.map((page) => fetch(url + `&pageNum=${page}`)));

  const json = await Promise.all(results.map((result) => result.json()));
  return [firstPage, ...json].reduce((prev, current) => prev.concat(current.txs), []);
}

async function fetch_total_donations(walletAddress) {
  const txs = await query_donate_transactions_all_pages();

  return txs.filter((tx) => tx.vin.some((v) => v.addr === walletAddress)).length;
}

export async function fetch_global_stats(walletAddress = null) {
  const store = create_global_store();

  const [
    resCurrency,
    resWallet,
    resFluxNodes,
    resFluxVersion,
    resBenchInfo,
    resFluxInfo,
    resRichList,
    resTotalDonations,
    resFractusCount
  ] = await Promise.allSettled([
    fetch('https://explorer.runonflux.io/api/currency'),
    walletAddress == null
      ? Promise.reject(new Error('Empty address'))
      : fetch('https://explorer.runonflux.io/api/addr/' + walletAddress + '/?noTxList=1'),
    fetch('https://api.runonflux.io/daemon/getzelnodecount'),
    fetch('https://raw.githubusercontent.com/RunOnFlux/flux/master/package.json'),
    fetch(FLUXNODE_INFO_API_URL + '/api/v1/bench-version', { ...REQUEST_OPTIONS_API }),
    fetch('https://api.runonflux.io/daemon/getinfo'),
    fetch('https://explorer.runonflux.io/api/statistics/richest-addresses-list'),
    fetch_total_donations(walletAddress),
    get_fractus_count()
  ]);

  if (resCurrency.status == 'fulfilled') {
    const res = resCurrency.value;
    const json = await res.json();
    store.flux_price_usd = json.data.rate;
  }

  if (resWallet.status == 'fulfilled') {
    const res = resWallet.value;
    const json = await res.json();
    const balance = json['balance'];
    store.wallet_amount_flux = Math.round((balance + Number.EPSILON) * 100) / 100;
  }

  if (resFluxNodes.status == 'fulfilled') {
    const res = resFluxNodes.value;
    const json = await res.json();
    const stats = json.data;

    store.node_count.cumulus = stats['cumulus-enabled'];
    store.node_count.nimbus = stats['nimbus-enabled'];
    store.node_count.stratus = stats['stratus-enabled'];

    store.node_count.total = stats['total'];
  }

  if (resFluxVersion.status == 'fulfilled') {
    const res = resFluxVersion.value;
    const json = await res.json();
    store.fluxos_latest_version = fluxos_version_desc_parse(json.version);
  }

  if (resBenchInfo.status == 'fulfilled') {
    const res = resBenchInfo.value;
    if (res.status === 200) {
      const json = await res.json();
      store.bench_latest_version = fluxos_version_desc_parse(json['version']);
    }
  }

  if (resFluxInfo.status == 'fulfilled') {
    const res = resFluxInfo.value;
    const json = await res.json();
    store.current_block_height = json['data']['blocks'];
  }

  if (resRichList.status == 'fulfilled') {
    const res = resRichList.value;
    const json = await res.json();
    store.in_rich_list = json.some((wAddress) => wAddress.address === walletAddress);
  }

  if (resTotalDonations.status == 'fulfilled') {
    const res = resTotalDonations.value;
    store.total_donations = res;
  }

  if (resFractusCount.status == 'fulfilled') {
    const res = resFractusCount.value;
    store.node_count.fractus = res;
  }

  fill_rewards(store);
  window.gstore = store;

  return store;
}

/* ======= node health ======= */

function wallet_health_entry() {
  return {
    node_count: 0,
    projection_daily: { flux: 0, usd: 0 },
    projection_montly: { flux: 0, usd: 0 }
  };
}

export function wallet_health_full() {
  return {
    cumulus: wallet_health_entry(),
    nimbus: wallet_health_entry(),
    stratus: wallet_health_entry(),
    fractus: wallet_health_entry(),
    total_nodes: 0
  };
}

/* ======= nodes overview ======= */

const REQUEST_OPTIONS_API = {
  credentials: 'omit',
  headers: {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.5'
  },
  method: 'GET',
  mode: 'cors'
};

function empty_flux_node() {
  return {
    id: 0,
    maybe_online: false,
    ip_full: {
      host: '',
      port: null,

      active_port_api: null,
      active_port_os: null
    },
    ip_display: false,
    tier: 'UNKNOWN', // "CUMULUS" | "NIMBUS" | "STRATUS" | "FRACTUS" | "UNKNOWN"
    rank: -1,
    last_reward: '-',
    next_reward: '-',
    benchmark_status: 'unknown', // 'unknown' | 'failed' | 'passed' | 'offline' | 'running'
    bench_version: fluxos_version_desc(0, 0, 0),
    flux_os: fluxos_version_desc(0, 0, 0),
    cores: 0,
    threads: 0,
    eps: 0,
    ram: 0,
    dws: 0,
    total_storage: 0,
    down_speed: 0,
    up_speed: 0,
    last_benchmark: '-',
    appCount: 0,
    uptime: 0,

    last_confirmed_height: 0
    // maintenance_win: '-'
  };
}

function calc_next_reward(rank) {
  return format_minutes(rank * 2);
}

export function calc_mtn_window(last_confirmed_height, current_height) {
  const BLOCK_RATE = 120;

  const win = BLOCK_RATE - (current_height - last_confirmed_height);

  if (win <= 0) return 'Closed';

  return format_minutes(win * 2);
}

const DISPLAY_DATE_FORMAT = 'DD-MMM-YYYY HH:mm:ss';

const DEFAULT_FLUX_PORT_API = 16127;
const DEFAULT_FLUX_PORT_OS = 16126;

export function normalize_raw_node_tier(node) {
  return node['tier'].toUpperCase();
}

export async function getWalletNodes(walletAddress) {
  // implement and live in the dark(background) so we can turn it on when ranking feature is fixed
  let wNodes = [];
  if (process.env.REACT_APP_ENABLE_FLUX_NODE_API === 'true') {
    try {
      const res = await fetch(API_FLUX_NODE_URL + walletAddress);
      wNodes = (await res.json())?.data;
    } catch {}
  } else {
    const listResponse = await fetch(API_FLUX_NODES_ALL_URL);
    const data = await listResponse.json();
    wNodes = data.fluxNodes.filter((n) => n.payment_address == walletAddress);
  }
  return wNodes;
}

export function transformRawNode(node) {
  let fluxNode = empty_flux_node();
  const ipRaw = node['ip'];
  if (ipRaw) {
    fluxNode.maybe_online = true;

    const ipParts = ipRaw.split(':');

    fluxNode.ip_full.host = ipParts[0];
    if (ipParts.length > 1) {
      const portApi = +ipParts[1] || DEFAULT_FLUX_PORT_API;

      fluxNode.ip_full.port = portApi;

      fluxNode.ip_full.active_port_api = portApi;
      fluxNode.ip_full.active_port_os = portApi - 1;
    } else {
      fluxNode.ip_full.port = null;

      fluxNode.ip_full.active_port_api = DEFAULT_FLUX_PORT_API;
      fluxNode.ip_full.active_port_os = DEFAULT_FLUX_PORT_OS;
    }

    fluxNode.id = ipRaw;
    fluxNode.ip_display = ipRaw;
  } else {
    fluxNode.id = node['txhash'];
  }

  fluxNode.tier = normalize_raw_node_tier(node);
  fluxNode.rank = node['rank'] || 0;
  fluxNode.last_reward = dayjs.unix(node['lastpaid']).format(DISPLAY_DATE_FORMAT);
  fluxNode.next_reward = calc_next_reward(node.rank);
  fluxNode.last_confirmed_height = node['last_confirmed_height'] || 0;

  return fluxNode;
}

function make_offline(fluxNode) {
  fluxNode.benchmark_status = 'offline';
  return undefined;
}

function _fillPartial_bench_info(fluxNode, bench_info) {
  if (bench_info !== null) fluxNode.bench_version = fluxos_version_desc_parse(bench_info['version']);
}

function _fillPartial_benchmarks(fluxNode, benchmarks) {
  if (benchmarks === null) return make_offline(fluxNode);

  switch (benchmarks['benchmark_status']) {
    case 'failed':
      fluxNode.benchmark_status = 'failed';
      break;
    case 'running':
      fluxNode.benchmark_status = 'running';
      break;

    default:
      fluxNode.benchmark_status = 'passed';
  }

  fluxNode.cores = parseInt(benchmarks['real_cores'] || 0);
  fluxNode.threads = parseInt(benchmarks['cores'] || 0);
  fluxNode.eps = benchmarks['eps'] || 0;
  fluxNode.ram = benchmarks['ram'] || 0;
  fluxNode.dws = benchmarks['ddwrite'] || 0;
  fluxNode.total_storage = benchmarks['totalstorage'] || 0;
  fluxNode.down_speed = benchmarks['download_speed'] || 0;
  fluxNode.up_speed = benchmarks['upload_speed'] || 0;
  fluxNode.thunder = benchmarks['thunder'] || false;

  fluxNode.last_benchmark = dayjs.unix(benchmarks['time']).format(DISPLAY_DATE_FORMAT);
}
function _fillPartial_version(fluxNode, version) {
  if (version !== null) fluxNode.flux_os = fluxos_version_desc_parse(version);
}
function _fillPartial_apps(fluxNode, installedApps) {
  if (installedApps !== null) {
    fluxNode.appCount = installedApps?.length;
    fluxNode.installedApps = installedApps;
  }
}

function _fillPartial_uptime(fluxNode, uptime) {
  if (uptime !== null) fluxNode.uptime = uptime;
}

const make_node_ip = (fluxNode) => fluxNode.ip_full.host + ':' + fluxNode.ip_full.active_port_api;

let _fetchAndFillNodeInfo;
if (FLUXNODE_INFO_API_MODE === 'proxy') {
  _fetchAndFillNodeInfo = async (fluxNode) => {
    let responseOK = false;
    let jsonData = {};

    try {
      const response = await fetch(`${FLUXNODE_INFO_API_URL}/api/v1/node-single/` + make_node_ip(fluxNode), {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        }
      });

      responseOK = response.status == 200;
      jsonData = await response.json();
    } catch {}

    if (!(responseOK && jsonData['success'])) return make_offline(fluxNode);

    let targetNode = jsonData['node']['results'];

    _fillPartial_bench_info(fluxNode, targetNode['node_info'].data?.benchmark?.info);
    _fillPartial_benchmarks(fluxNode, targetNode['node_info'].data?.benchmark?.bench);
    _fillPartial_version(fluxNode, targetNode['node_info'].data?.flux?.version);
    _fillPartial_apps(fluxNode, targetNode['apps'].data);
    _fillPartial_uptime(fluxNode, targetNode['uptime'].data);
  };
}
// FLUXNODE_INFO_API_MODE == 'debug'
else {
  _fetchAndFillNodeInfo = async (fluxNode) => {
    let server = 'http://' + make_node_ip(fluxNode);

    const promiseNodeInfo = fetch(server + API_NODE_INFO_ENDPOINT, { ...REQUEST_OPTIONS_API });
    const promiseAppList = fetch(server + API_FLUX_APPLIST_ENDPOINT, { ...REQUEST_OPTIONS_API });
    const promiseUptimeData = fetch(server + API_FLUX_UPTIME_ENDPOINT, { ...REQUEST_OPTIONS_API });

    let reqSuccess;

    let resultNodeInfo;
    let resultAppList;
    let resultUptime;

    try {
      [resultNodeInfo, resultAppList, resultUptime] = await Promise.all([
        promiseNodeInfo,
        promiseAppList,
        promiseUptimeData
      ]);
      reqSuccess = true;
    } catch {
      reqSuccess = false;
    }

    if (reqSuccess) {
      const nodeInfo = (await resultNodeInfo.json())?.data;
      _fillPartial_bench_info(fluxNode, nodeInfo?.benchmark?.info);
      _fillPartial_benchmarks(fluxNode, nodeInfo?.benchmark?.bench);
      _fillPartial_version(fluxNode, nodeInfo?.flux?.version);
      _fillPartial_apps(fluxNode, (await resultAppList.json()).data);
      _fillPartial_uptime(fluxNode, (await resultUptime.json()).data);
    }
  };
}

export async function fillPartialNode(node) {
  // Do not try to reach servers if they are confirmed to be offline
  if (!node.maybe_online) return make_offline(node);

  await _fetchAndFillNodeInfo(node);
}

function fill_tier_health(target, tierRewardProjections, fluxPriceUsd) {
  target.projection_daily.flux =
    target.node_count * (tierRewardProjections.payment_amount + tierRewardProjections.pa_amount);
  target.projection_daily.usd = target.projection_daily.flux * fluxPriceUsd;

  target.projection_montly.flux = target.projection_daily.flux * 30.0;
  target.projection_montly.usd = target.projection_daily.usd * 30.0;
}

export function fill_health(health, gstore) {
  fill_tier_health(health.cumulus, gstore.reward_projections.cumulus, gstore.flux_price_usd);
  fill_tier_health(health.nimbus, gstore.reward_projections.nimbus, gstore.flux_price_usd);
  fill_tier_health(health.stratus, gstore.reward_projections.stratus, gstore.flux_price_usd);
  // Fractus is parts of Cumulus tier
  fill_tier_health(health.fractus, gstore.reward_projections.fractus, gstore.flux_price_usd);
}

export async function validateAddress(address) {
  try {
    const res = await fetch('https://api.runonflux.io/explorer/balance?address=' + address);
    const json = await res.json();
    return json['data'] !== undefined;
  } catch {
    return false;
  }
}

export async function getDemoWallet() {
  try {
    const response = await fetch(`${FLUXNODE_INFO_API_URL}/api/v1/demo`, {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    });
    const jsonData = await response.json();
    return jsonData;
  } catch {
    return null;
  }
}
/* ======================================================================= */
/* ======================================================================= */
/* =========================== Fractus Count =========================== */

async function get_fractus_count() {
  const res = await fetch(API_FRACTUS_LIST);
  const json = await res.json();
  const thunderCount = json.data.filter((data) => data.benchmark.bench.thunder).length;

  return thunderCount;
}

/* ======================================================================= */
/* ======================================================================= */
/* =========================== PARALLEL ASSETS =========================== */
/* ======================================================================= */
/* ======================================================================= */

function single_pa_info() {
  return {
    possible_claimable: 0,
    amount_claimed: 0,
    fusion_fee: 0,
    paid: 0,
    amount_received: 0
  };
}

export function pa_summary_full() {
  return {
    total_claimable: 0,
    total_claimed_to_date: 0,
    total_mined: 0,
    assets: {
      kda: single_pa_info(),
      eth: single_pa_info(),
      bsc: single_pa_info(),
      trn: single_pa_info(),
      sol: single_pa_info(),
      avx: single_pa_info(),
      erg: single_pa_info(),
      alg: single_pa_info()
    }
  };
}

async function fetch_fusion_fees() {
  const resp = await fetch('https://fusion.runonflux.io/fees');
  const result = await resp.json();

  return result.data.mining;
}

async function fetch_wallet_pas(walletAddress) {
  const resp = await fetch('https://fusion.runonflux.io/coinbase/summary?address=' + walletAddress);
  const json = await resp.json();

  return json['data'];
}

export async function wallet_pas_summary(walletAddress) {
  const promiseFees = fetch_fusion_fees();
  const promiseFusion = fetch_wallet_pas(walletAddress);

  const [resultFees, resultFusion] = await Promise.allSettled([promiseFees, promiseFusion]);

  const summary = pa_summary_full();

  if (resultFusion.status == 'fulfilled') {
    const fusion = resultFusion.value;

    summary.total_claimable = fusion.maxClaimableTotal - fusion.claimedTotal;
    summary.total_claimed_to_date = fusion.claimedTotal;
    summary.total_mined = fusion.maxClaimableTotal;

    for (const stats of fusion.chainStatistics) {
      let targetPAInfo = null;
      switch (stats.chain) {
        case 'kda':
          targetPAInfo = summary.assets.kda;
          break;
        case 'eth':
          targetPAInfo = summary.assets.eth;
          break;
        case 'bsc':
          targetPAInfo = summary.assets.bsc;
          break;
        case 'trx':
          targetPAInfo = summary.assets.trn;
          break;
        case 'sol':
          targetPAInfo = summary.assets.sol;
          break;
        case 'avax':
          targetPAInfo = summary.assets.avx;
          break;
        case 'erg':
          targetPAInfo = summary.assets.erg;
          break;
        case 'alg':
          targetPAInfo = summary.assets.alg;
          break;

        default:
          break;
      }

      if (targetPAInfo == null) continue;

      targetPAInfo.possible_claimable = stats.possibleToClaim;
      targetPAInfo.amount_claimed = stats.claimedAmount;
      targetPAInfo.paid = stats.feesPaid;
      targetPAInfo.amount_received = stats.receivedAmount;
    }
  }

  if (resultFees.status == 'fulfilled') {
    const fees = resultFees.value;

    summary.assets.kda.fusion_fee = fees['kda'];
    summary.assets.eth.fusion_fee = fees['eth'];
    summary.assets.bsc.fusion_fee = fees['bsc'];
    summary.assets.trn.fusion_fee = fees['trx'];
    summary.assets.sol.fusion_fee = fees['sol'];
    summary.assets.avx.fusion_fee = fees['avax'];
    summary.assets.erg.fusion_fee = fees['erg'];
  }

  return summary;
}

/* ===================================================== */
/* ======================== DOS ======================== */
/* ===================================================== */

export async function isWalletDOSState(address) {
  // Note: DOS list is updated very frequently, so there is no point in caching the response for
  // future wallet addresses.

  const listResponse = await fetch(API_DOS_LIST);
  const json = await listResponse.json();
  const dosList = json['data'];

  for (let i = 0; i < dosList.length; i++)
    //
    if (dosList[i]['payment_address'] == address)
      //
      return true;

  return false;
}
