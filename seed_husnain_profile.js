    // Same public (non-secret) values as background/config.js — needed here to verify the cloud
    // push directly against Supabase rather than trusting the background script's relay blindly.
    const SUPABASE_URL      = 'https://hokgbtrptddjgwgvvhrb.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_AAxP-tTi-9GMyfQxSpmC0A_NOlYt03T';

    const logEl = document.getElementById('log');
    function line(text, cls) {
      const d = document.createElement('div');
      d.className = 'step' + (cls ? ' ' + cls : '');
      d.textContent = text;
      logEl.appendChild(d);
    }

    (async () => {
      if (typeof chrome === 'undefined' || !chrome.storage) {
        line('chrome.storage is not available on this page — this must be opened as a real chrome-extension:// URL, not saved/opened as a local file.', 'err');
        return;
      }

      try {
        // 1. Job Search profile
        await chrome.storage.local.set({
          jobProfile: {
            senderName: 'Husnain',
            currentTitle: 'Senior AI/ML Engineer',
            background: '5+ years building production AI/ML and full-stack systems — agentic AI, RAG, LLM fine-tuning, and voice AI, alongside React/Next.js and Python backends. Currently Head of Engineering at an AI voice-ordering startup, previously led a 30+ engineer team shipping AI platforms for healthcare, legal, and education clients.',
            yearsExp: '6–10 years (senior)',
            targetRoles: ['AI/ML Engineer', 'Lead AI Engineer', 'Head of Engineering', 'Engineering Manager'],
            targetIndustries: ['AI/SaaS', 'HealthTech', 'FinTech'],
          },
        });
        line('✓ Wrote jobProfile', 'ok');

        // 2. Freelance/Consulting profile + ICP
        await chrome.storage.local.set({
          b2cProfile: {
            expertise: 'Senior AI/ML engineer and full-stack developer — agentic AI, LLM fine-tuning, RAG, and voice AI, with React/Next.js, Node.js, Django, FastAPI, and Flutter/React Native across web and mobile. 5+ years shipping production systems, including compliance-conscious healthcare backends and enterprise platforms.',
            services: 'AI agent and RAG system builds, LLM fine-tuning and integration, voice AI pipelines (Deepgram/Whisper/ElevenLabs/custom TTS), full-stack web and mobile development, workflow automation (n8n/Make/Zapier), and production deployment (AWS/DigitalOcean/Docker).',
            targetClient: 'Funded early- to growth-stage startups and operations-heavy small businesses that need a senior engineer to own an AI or full-stack build end to end — from a founder validating an AI product to a business drowning in manual work a real automation platform could eliminate.',
            problem: 'Teams that need to ship an AI-powered product (voice, chat, agents, RAG) without in-house ML expertise, or businesses losing hours a week to manual ops work.',
            valueProp: 'Shipped 15+ production AI/ML and full-stack platforms solo or as lead — from a Google Play app to a multi-tenant SaaS voice platform handling 500 calls/day. One senior engineer who owns architecture through deployment.',
            senderName: 'Husnain',
          },
          b2cTargetIndustries: ['Healthcare / HealthTech', 'FinTech', 'AI Security', 'Audio / Voice AI', 'Early-stage Startups'],
        });
        line('✓ Wrote b2cProfile + b2cTargetIndustries', 'ok');

        // 3. B2B Sales — writes into the currently active ICP profile (creating a "Default" one
        // if none exists yet), matching the real multi-profile schema.
        const { icpProfiles, activeIcpProfileId } = await chrome.storage.local.get(['icpProfiles', 'activeIcpProfileId']);
        const businessProfile = {
          expertise: '5+ years as a senior AI/ML engineer and full-stack developer — agentic AI, LLM fine-tuning, RAG, and production ML systems, plus React/Next.js, Node.js, Django, and FastAPI across web and mobile.',
          offer: 'AI agent and multi-agent systems (LangGraph), RAG pipelines, LLM infrastructure, workflow automation, and MLOps/vector search — built and owned end-to-end, from architecture through production deployment.',
          idealCustomer: 'Product companies and scaling/high-growth startups moving core operations onto AI-driven systems — companies that need agent-based architecture built with enterprise-grade reliability, not a prototype.',
          problem: 'Companies that know they need agentic AI/automation but lack in-house expertise in agent orchestration, RAG, or production ML infra — or have tried and hit reliability/observability problems in production.',
          valueProp: 'Startup velocity with enterprise-grade discipline — one team, full accountability from architecture through deployment, deep LangGraph/multi-agent expertise, production reliability and observability built in from day one.',
          senderName: 'Husnain',
          companyName: 'Satyron',
        };
        const targetIndustries = ['AI/SaaS', 'HealthTech', 'FinTech', 'Voice/Audio AI', 'Blockchain/Crypto'];

        let profiles = Array.isArray(icpProfiles) ? icpProfiles : [];
        let activeId;
        if (!profiles.length) {
          activeId = `icp-${Date.now()}`;
          profiles = [{ id: activeId, name: 'Default', targetIndustries, excludeIndustries: ['Tech service providers', 'IT outsourcing / staffing', 'Digital / marketing agencies'], businessProfile }];
        } else {
          const active = profiles.find(p => p.id === activeIcpProfileId) || profiles[0];
          active.targetIndustries = targetIndustries;
          active.businessProfile = businessProfile;
          activeId = active.id;
        }
        await chrome.storage.local.set({ icpProfiles: profiles, activeIcpProfileId: activeId });
        line('✓ Wrote icpProfiles (B2B Sales — "' + (profiles.find(p => p.id === activeId)?.name || 'Default') + '")', 'ok');

        // 4. Post Creator — Personal Brand
        await chrome.storage.local.set({
          creatorProfile: {
            name: 'Husnain',
            linkedinUrl: 'https://www.linkedin.com/in/husnainali-ai-ml-automation-fullstack-engineer/',
            audience: 'CTOs, engineering leaders, AI/product founders, and senior engineers',
            goal: 'build personal brand',
            postStyle: 'educational',
            domains: ['Agentic AI', 'RAG', 'LLM Fine-Tuning', 'Voice AI', 'Full-Stack Development'],
          },
        });
        line('✓ Wrote creatorProfile (Post Creator — Personal Brand)', 'ok');

        // 5. Post Creator — Company Brand (Satyron)
        await chrome.storage.local.set({
          companyProfile: {
            name: 'Satyron',
            industry: 'AI / SaaS — agentic AI & automation',
            about: 'Satyron builds AI agent and automation systems for product companies and scaling startups — from RAG pipelines and LLM infrastructure to full-stack platforms, taken end-to-end from architecture through production deployment.',
            products: 'AI agent and multi-agent systems (LangGraph), RAG pipelines, LLM infrastructure, workflow automation, and MLOps/vector search.',
            icp: 'Product companies and scaling/high-growth startups moving core operations onto AI-driven systems that need agent-based architecture built with enterprise-grade reliability.',
            goal: 'attract clients and close deals',
            postStyle: 'thought_leadership',
          },
        });
        line('✓ Wrote companyProfile (Post Creator — Company Brand)', 'ok');

        // 6. Push everything to the cloud so it shows up on your other signed-in devices too.
        // Steps 1-5 only wrote to chrome.storage.local on THIS browser. Normally, saving via the
        // Options page's own Save buttons also pushes to Supabase, via a chrome.storage.onChanged
        // listener that lives inside options/index.js — but that listener only runs while an
        // Options page tab happens to already be open, which is not the case here. So this page
        // pushes explicitly, matching options/index.js's syncSettingsToCloud() exactly (same
        // SYNC_KEYS list, same per-field timestamps, same SAVE_SETTINGS message).
        const SYNC_KEYS = [
          'analysisIntent',
          'targetIndustries', 'excludeIndustries', 'businessProfile',
          'icpProfiles', 'activeIcpProfileId',
          'messagePresets', 'b2cProfile', 'jobProfile',
          'b2cMessagePresets', 'jobMessagePresets', 'b2cTargetIndustries', 'b2cExcludeIndustries',
          'creatorProfile', 'companyProfile', 'reminderSettings',
          'openaiApiKey', 'hubspotApiKey',
        ];
        const writtenKeys = ['jobProfile', 'b2cProfile', 'b2cTargetIndustries', 'icpProfiles', 'activeIcpProfileId', 'creatorProfile', 'companyProfile'];
        const { settingsFieldTimestamps } = await chrome.storage.local.get('settingsFieldTimestamps');
        const now = Date.now();
        const updatedTimestamps = { ...(settingsFieldTimestamps || {}) };
        writtenKeys.forEach(k => { updatedTimestamps[k] = now; });
        await chrome.storage.local.set({ settingsFieldTimestamps: updatedTimestamps });

        const { googleUser } = await chrome.storage.local.get('googleUser');
        if (!googleUser) {
          line('⚠ Not signed in on this device — data saved locally only. Sign in, then re-run this page so it can also sync to your other devices.', 'err');
        } else {
          const settings = await chrome.storage.local.get([...SYNC_KEYS, 'settingsFieldTimestamps']);
          try {
            const pushResult = await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings });
            if (pushResult && pushResult.ok) {
              line('✓ Push to cloud confirmed by server.', 'ok');

              // Don't just trust the push response — read straight back from Supabase with the
              // same Google token, the same way another device's sign-in would, so this page
              // proves the round trip actually works instead of assuming it.
              try {
                const authResult = await chrome.identity.getAuthToken({ interactive: false });
                const token = typeof authResult === 'string' ? authResult : authResult?.token;
                const verifyResp = await fetch(`${SUPABASE_URL}/functions/v1/sync-user`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
                  body: JSON.stringify({ googleToken: token }),
                });
                const verifyData = await verifyResp.json();
                const cloudJobTitle = verifyData?.settings?.jobProfile?.currentTitle;
                const cloudCompanyName = verifyData?.settings?.companyProfile?.name;
                if (cloudJobTitle === 'Senior AI/ML Engineer' && cloudCompanyName === 'Satyron') {
                  line('✓ Verified directly against the cloud — your Google account now holds this data for real. Signing in on another device should pull it in.', 'ok');
                } else {
                  line('✗ Server said the push succeeded, but reading it straight back shows different/missing data (jobProfile.currentTitle=' + JSON.stringify(cloudJobTitle) + ', companyProfile.name=' + JSON.stringify(cloudCompanyName) + '). This points to a backend issue, not this page — tell Claude this verification step failed.', 'err');
                }
              } catch (verifyErr) {
                line('⚠ Pushed, but could not verify by reading it back: ' + verifyErr.message, 'err');
              }
            } else {
              line('✗ Cloud push failed: ' + (pushResult?.error || 'unknown error') + '. Data is saved on THIS device only — it will not appear on other devices until this is fixed.', 'err');
            }
          } catch (err) {
            line('✗ Cloud sync failed to send: ' + err.message + '. Data is saved on this device regardless.', 'err');
          }
        }

        // Read everything back and print it, so success is visible on the page itself — no
        // DevTools console needed.
        const readback = await chrome.storage.local.get(['jobProfile', 'b2cProfile', 'b2cTargetIndustries', 'icpProfiles', 'activeIcpProfileId', 'creatorProfile', 'companyProfile']);
        line('');
        line('All writes confirmed. Stored data:', 'ok');
        const pre = document.createElement('pre');
        pre.textContent = JSON.stringify(readback, null, 2);
        logEl.appendChild(pre);
        line('Go to the Options page and refresh it — Job Search, Freelance/Consulting, B2B Sales, and Post Creator (Personal + Company) should all show this data now. You can delete the two seed_husnain_profile.* files afterward.');
      } catch (err) {
        line('✗ ' + err.message, 'err');
      }
    })();
