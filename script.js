// Simple marketing assistant using AIDA model and basic emotion-based angles.
document.addEventListener('DOMContentLoaded', () => {
  initChatbot();
  initAdResearch();
});

function initChatbot() {
  const emotions = ['joie', 'confiance', 'excitation', 'surprise', 'sécurité', 'bien‑être', 'facilité'];

  function generateResponse(product) {
    const emotion = emotions[Math.floor(Math.random() * emotions.length)];
    return `Pour votre produit « ${product} », voici quelques angles marketing inspirés du modèle AIDA :\n\n` +
      `Attention : Attirez l’attention en mettant en avant une caractéristique unique de votre produit.\n` +
      `Intérêt : Expliquez comment ce produit apporte de la ${emotion} à vos clients et résout un problème spécifique.\n` +
      `Désir : Soulignez les bénéfices émotionnels (${emotion}) et montrez comment votre produit améliore leur quotidien.\n` +
      `Action : Incitez à l’action avec une offre spéciale, une garantie ou un appel à l’achat clair.`;
  }

  function appendMessage(text, role) {
    const log = document.getElementById('chat-log');
    if (!log) return;
    const div = document.createElement('div');
    div.className = `chat-message ${role}`;
    div.innerText = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function handleSend() {
    const input = document.getElementById('product-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    appendMessage(text, 'user');
    const response = generateResponse(text);
    appendMessage(response, 'bot');
    input.value = '';
  }

  const sendBtn = document.getElementById('send-btn');
  const inputField = document.getElementById('product-input');

  if (sendBtn && inputField) {
    sendBtn.addEventListener('click', handleSend);
    inputField.addEventListener('keypress', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleSend();
      }
    });
  }
}

function initAdResearch() {
  const form = document.getElementById('research-form');
  const queryInput = document.getElementById('research-query');
  const resultsGrid = document.getElementById('research-results');
  const feedback = document.getElementById('research-feedback');
  const loader = document.getElementById('research-loading');

  if (!form || !queryInput || !resultsGrid || !feedback || !loader) {
    return;
  }

  const config = buildResearchConfig();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = queryInput.value.trim();

    if (!query) {
      feedback.textContent = 'Veuillez saisir un mot-clé avant de lancer la recherche.';
      queryInput.focus();
      return;
    }

    feedback.textContent = 'Collecte des annonces en cours…';
    setBusyState(resultsGrid, true);
    toggleLoader(loader, true);
    clearResults(resultsGrid);

    try {
      const { ads, warnings } = await runAdResearch(query, config);

      if (warnings.length > 0) {
        const warningText = warnings.join(' ');
        feedback.textContent = `${warningText} Résultats pour « ${query} » :`;
      } else {
        feedback.textContent = `Résultats pour « ${query} » :`;
      }

      if (ads.length === 0) {
        feedback.textContent += ' aucune annonce trouvée. Essayez un autre mot-clé ou vérifiez vos accès API.';
      } else {
        renderAdResults(ads, resultsGrid);
      }
    } catch (error) {
      console.error('Ad research error:', error);
      feedback.textContent = `Impossible de récupérer les annonces : ${error.message}`;
      clearResults(resultsGrid);
    } finally {
      toggleLoader(loader, false);
      setBusyState(resultsGrid, false);
    }
  });
}

function buildResearchConfig() {
  const overrides = window.AD_RESEARCH_CONFIG || {};
  const facebookOverrides = overrides.facebook || overrides.facebookConfig || {};
  const tiktokOverrides = overrides.tiktok || overrides.tiktokConfig || {};

  return {
    globalLimit: overrides.globalLimit || overrides.limit || 12,
    facebook: {
      baseUrl: facebookOverrides.baseUrl || overrides.facebookBaseUrl || 'https://graph.facebook.com/v18.0/ads_archive',
      accessToken: facebookOverrides.accessToken || overrides.facebookAccessToken || '',
      adType: facebookOverrides.adType || overrides.facebookAdType || 'POLITICAL_AND_ISSUE_ADS',
      countries: facebookOverrides.countries || overrides.facebookCountries || ['FR'],
      limit: facebookOverrides.limit || overrides.facebookLimit || 8,
      pageSize: facebookOverrides.pageSize || overrides.facebookPageSize || 25,
      fields: facebookOverrides.fields || overrides.facebookFields || [
        'ad_delivery_start_time',
        'ad_delivery_stop_time',
        'ad_creation_time',
        'ad_creative_body',
        'ad_creative_link_caption',
        'ad_creative_link_description',
        'ad_creative_link_title',
        'ad_creative_link_url',
        'ad_snapshot_url',
        'image_url',
        'impressions',
        'page_name',
        'publisher_platforms',
        'spend'
      ].join(',')
    },
    tiktok: {
      baseUrl: tiktokOverrides.baseUrl || overrides.tiktokBaseUrl || 'https://business-api.tiktok.com/open_api/v1.3/ad/search/',
      accessToken: tiktokOverrides.accessToken || overrides.tiktokAccessToken || '',
      advertiserId: tiktokOverrides.advertiserId || overrides.tiktokAdvertiserId || '',
      region: tiktokOverrides.region || overrides.tiktokRegion || 'FR',
      limit: tiktokOverrides.limit || overrides.tiktokLimit || 8,
      pageSize: tiktokOverrides.pageSize || overrides.tiktokPageSize || 20,
      method: tiktokOverrides.method || overrides.tiktokMethod || 'POST'
    }
  };
}

async function runAdResearch(query, config) {
  const tasks = [];
  const warnings = [];

  if (config.facebook.accessToken) {
    tasks.push({
      label: 'Facebook Ads Library',
      promise: fetchFacebookAds(query, config.facebook)
    });
  } else {
    warnings.push('Facebook Ads Library non configurée.');
  }

  if (config.tiktok.accessToken && config.tiktok.advertiserId) {
    tasks.push({
      label: 'TikTok Ads Library',
      promise: fetchTikTokAds(query, config.tiktok)
    });
  } else {
    warnings.push('TikTok Ads Library non configurée.');
  }

  const settled = await Promise.allSettled(tasks.map((task) => task.promise));

  const ads = [];
  settled.forEach((result, index) => {
    const label = tasks[index]?.label || 'Source inconnue';
    if (result.status === 'fulfilled') {
      ads.push(...result.value);
    } else {
      console.error(`${label} error:`, result.reason);
      warnings.push(`${label} indisponible (${result.reason?.message || 'erreur inconnue'}).`);
    }
  });

  const globalLimit = config.globalLimit || ads.length;
  const sortedAds = ads.sort((a, b) => {
    const dateA = a.startDate ? new Date(a.startDate).getTime() : 0;
    const dateB = b.startDate ? new Date(b.startDate).getTime() : 0;
    return dateB - dateA;
  });

  return { ads: sortedAds.slice(0, globalLimit), warnings };
}

async function fetchFacebookAds(query, options) {
  const results = [];
  let cursor = null;
  const limit = options.limit || 8;

  while (results.length < limit) {
    const params = new URLSearchParams({
      search_terms: query,
      ad_reached_countries: Array.isArray(options.countries) ? options.countries.join(',') : 'FR',
      fields: options.fields,
      limit: Math.min(options.pageSize || 25, limit - results.length).toString(),
      access_token: options.accessToken
    });

    if (options.adType) {
      params.set('ad_type', options.adType);
    }

    if (cursor) {
      params.set('after', cursor);
    }

    const response = await fetch(`${options.baseUrl}?${params.toString()}`, {
      method: 'GET',
      mode: 'cors'
    });

    if (!response.ok) {
      throw new Error(`code ${response.status}`);
    }

    const payload = await response.json();
    const data = payload.data || [];

    data.forEach((item) => {
      results.push(mapFacebookAd(item, query));
    });

    cursor = payload.paging?.cursors?.after;

    if (!cursor || !payload.paging?.next) {
      break;
    }
  }

  return results.slice(0, limit);
}

async function fetchTikTokAds(query, options) {
  const results = [];
  let page = 1;
  const limit = options.limit || 8;
  const pageSize = options.pageSize || 20;
  let hasMore = true;

  while (results.length < limit && hasMore) {
    const payload = {
      advertiser_id: options.advertiserId,
      page: page,
      page_size: Math.min(pageSize, limit - results.length),
      search_keyword: query,
      region: options.region
    };

    const response = await fetch(options.baseUrl, {
      method: options.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Access-Token': options.accessToken
      },
      mode: 'cors',
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`code ${response.status}`);
    }

    const data = await response.json();
    const ads = data.data?.list || data.data?.ads || [];

    ads.forEach((item) => {
      results.push(mapTikTokAd(item, query));
    });

    const pageInfo = data.data?.page_info || data.data?.page || {};
    hasMore = Boolean(pageInfo.has_more && results.length < limit);
    page += 1;

    if (!hasMore) {
      break;
    }
  }

  return results.slice(0, limit);
}

function mapFacebookAd(raw, query) {
  const metrics = buildMetrics([
    { label: 'Impressions', value: formatRange(raw.impressions) },
    { label: 'Dépenses', value: formatCurrencyRange(raw.spend) },
    { label: 'Plateformes', value: Array.isArray(raw.publisher_platforms) ? raw.publisher_platforms.join(', ') : undefined }
  ]);

  const title = raw.ad_creative_link_title || raw.ad_creative_link_caption || raw.page_name || query;
  const description = raw.ad_creative_body || raw.ad_creative_link_description || '';
  const imageUrl = raw.image_url || raw.ad_creative_link_image || raw.ad_snapshot_url || null;

  return {
    id: raw.id || raw.ad_archive_id || `facebook-${Math.random().toString(36).slice(2)}`,
    source: 'Facebook Ads Library',
    title,
    description,
    imageUrl,
    metrics,
    startDate: raw.ad_delivery_start_time || raw.ad_creation_time || null,
    endDate: raw.ad_delivery_stop_time || null,
    url: raw.ad_snapshot_url || raw.ad_creative_link_url || null
  };
}

function mapTikTokAd(raw, query) {
  const creative = raw.creative_materials?.[0] || raw.creatives?.[0] || raw.creative || {};
  const imageUrl = creative.image_info?.image_url || creative.thumbnail_url || raw.image_url || raw.video_info?.cover_url || null;
  const metrics = buildMetrics([
    { label: 'Impressions', value: formatNumber(raw.stat?.impressions || raw.impressions) },
    { label: 'Clics', value: formatNumber(raw.stat?.clicks || raw.clicks) },
    { label: 'CTR', value: formatPercentage(raw.stat?.ctr || raw.ctr) }
  ]);

  return {
    id: raw.ad_id || raw.creative_id || `tiktok-${Math.random().toString(36).slice(2)}`,
    source: 'TikTok Ads Library',
    title: raw.ad_name || creative.creative_name || query,
    description: creative.text || creative.caption || raw.description || '',
    imageUrl,
    metrics,
    startDate: raw.start_time || raw.stat_time_day || raw.created_time || null,
    endDate: raw.end_time || raw.update_time || null,
    url: raw.preview_url || raw.share_url || null
  };
}

function renderAdResults(ads, container) {
  clearResults(container);

  ads.forEach((ad) => {
    const card = document.createElement('article');
    card.className = 'research-result';
    card.setAttribute('data-source', ad.source);

    const header = document.createElement('div');
    header.className = 'research-result-header';

    const title = document.createElement('h3');
    title.textContent = ad.title;

    const source = document.createElement('span');
    source.className = 'research-result-source';
    source.innerHTML = `<i class="fa-solid fa-chart-line"></i> ${ad.source}`;

    header.appendChild(title);
    header.appendChild(source);
    card.appendChild(header);

    if (ad.description) {
      const description = document.createElement('p');
      description.textContent = ad.description;
      card.appendChild(description);
    }

    if (ad.imageUrl) {
      const image = document.createElement('img');
      image.src = ad.imageUrl;
      image.alt = `Visuel d'annonce pour ${ad.title}`;
      card.appendChild(image);
    }

    if (ad.metrics.length > 0) {
      const metricsWrapper = document.createElement('div');
      metricsWrapper.className = 'research-metrics';
      ad.metrics.forEach((metric) => {
        const metricSpan = document.createElement('span');
        metricSpan.innerHTML = `<strong>${metric.label} :</strong> ${metric.value}`;
        metricsWrapper.appendChild(metricSpan);
      });
      card.appendChild(metricsWrapper);
    }

    const dates = document.createElement('p');
    dates.className = 'research-dates';
    const start = ad.startDate ? formatDate(ad.startDate) : '—';
    const end = ad.endDate ? formatDate(ad.endDate) : 'en cours';
    dates.innerHTML = `<strong>Période :</strong> ${start} → ${end}`;
    card.appendChild(dates);

    if (ad.url) {
      const link = document.createElement('a');
      link.href = ad.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.className = 'btn secondary';
      link.textContent = 'Voir l’annonce';
      card.appendChild(link);
    }

    container.appendChild(card);
  });
}

function clearResults(container) {
  container.innerHTML = '';
}

function toggleLoader(loader, show) {
  loader.classList.toggle('active', show);
  loader.setAttribute('aria-hidden', show ? 'false' : 'true');
}

function setBusyState(element, busy) {
  element.setAttribute('aria-busy', busy ? 'true' : 'false');
}

function formatRange(range) {
  if (!range) return undefined;
  const lower = range.lower_bound ?? range.lowerBound ?? range.lower;
  const upper = range.upper_bound ?? range.upperBound ?? range.upper;
  if (lower != null && upper != null) {
    return `${formatNumber(lower)} – ${formatNumber(upper)}`;
  }
  const value = range.value ?? range;
  return value != null ? formatNumber(value) : undefined;
}

function formatCurrencyRange(range) {
  const formatted = formatRange(range);
  if (!formatted) return undefined;
  return `${formatted} €`;
}

function formatNumber(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return undefined;
  }
  return new Intl.NumberFormat('fr-FR').format(Number(value));
}

function formatPercentage(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return undefined;
  }
  return `${(Number(value) * 100).toFixed(1)} %`;
}

function buildMetrics(entries) {
  return entries.filter((entry) => Boolean(entry.value)).map((entry) => ({
    label: entry.label,
    value: entry.value
  }));
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: 'numeric' });
}