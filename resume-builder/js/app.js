/**
 * ResumeCraft - Master Application Logic & Reactive Store
 */
import { INITIAL_DATA, SAMPLE_PRESETS, COLOR_PALETTES, FONT_OPTIONS, ACTION_VERBS, SUMMARY_TEMPLATES } from './data.js';
import { renderResume } from './templates.js';
import { calculateAtsScore } from './ats.js';

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const JOB_STOP_WORDS = new Set(
  'about after also and any are being can company could day each experience for from have into job just more most must our out per required role seeking should that the their them then this through under use using with will work years your'.split(' ')
);
const APPLICATION_STAGES = ['Saved', 'Preparing', 'Applied', 'Interview', 'Offer', 'Closed'];

function isValidDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

class ResumeCraftApp {
  constructor() {
    this.STORAGE_KEY = 'resumecraft_saved_data_v2';
    this.WORKSPACE_STORAGE_KEY = 'resumecraft_workspace_v1';
    this.zoomLevel = 0.85; // Default comfortable preview scale
    this.themeControlsInitialized = false;
    this.legacyResumeExists = this.hasLegacyResume();
    const workspace = this.loadWorkspace();
    this.masterState = workspace?.masterResume || this.loadState();
    this.applications = workspace?.applications || [];
    this.notificationsEnabled = workspace?.notificationsEnabled === true;
    this.openDashboardOnLoad = Boolean(workspace || this.legacyResumeExists);
    this.activeApplicationId = null;
    this.state = this.cloneResume(this.masterState);
    this.currentTab = 'personal';
    this.history = [JSON.stringify(this.state)];
    this.historyIndex = 0;
    this.historyTimer = null;
    this.isRestoringHistory = false;

    this.init();
  }

  cloneResume(data) {
    return this.normalizeState(JSON.parse(JSON.stringify(data)));
  }

  hasLegacyResume() {
    try {
      return Boolean(localStorage.getItem(this.STORAGE_KEY));
    } catch (error) {
      console.warn('Could not inspect the previous resume backup:', error);
      return false;
    }
  }

  loadWorkspace() {
    try {
      const saved = localStorage.getItem(this.WORKSPACE_STORAGE_KEY);
      if (!saved) return null;
      const parsed = JSON.parse(saved);
      if (!parsed || typeof parsed !== 'object' || parsed.version !== 1 ||
          !parsed.masterResume || typeof parsed.masterResume !== 'object') {
        console.warn('Saved workspace has an invalid format; using the existing resume backup.');
        return null;
      }

      const masterResume = this.normalizeState(parsed.masterResume);
      const rawApplications = Array.isArray(parsed.applications) ? parsed.applications : [];
      return {
        masterResume,
        applications: rawApplications
          .filter(application => application && typeof application === 'object')
          .map(application => this.normalizeApplication(application, masterResume)),
        notificationsEnabled: parsed.notificationsEnabled === true &&
          'Notification' in window && Notification.permission === 'granted'
      };
    } catch (error) {
      console.warn('Failed to load saved application workspace:', error);
      return null;
    }
  }

  normalizeApplication(raw, fallbackResume) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const stage = APPLICATION_STAGES.includes(source.stage) ? source.stage : 'Saved';
    return {
      id: typeof source.id === 'string' && source.id ? source.id : `application-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      company: typeof source.company === 'string' ? source.company : '',
      role: typeof source.role === 'string' ? source.role : '',
      url: typeof source.url === 'string' ? source.url : '',
      jobDescription: typeof source.jobDescription === 'string' ? source.jobDescription : '',
      stage,
      deadline: isValidDateOnly(source.deadline) ? source.deadline : '',
      notes: typeof source.notes === 'string' ? source.notes : '',
      createdAt: Number.isFinite(source.createdAt) ? source.createdAt : Date.now(),
      lastReminderDate: typeof source.lastReminderDate === 'string' ? source.lastReminderDate : '',
      resume: this.normalizeState(source.resume && typeof source.resume === 'object' ? source.resume : fallbackResume)
    };
  }

  writeWorkspace(showFailureToast = true) {
    try {
      localStorage.setItem(this.WORKSPACE_STORAGE_KEY, JSON.stringify({
        version: 1,
        masterResume: this.masterState,
        applications: this.applications,
        notificationsEnabled: this.notificationsEnabled
      }));
      return true;
    } catch (error) {
      console.warn('Failed to save application workspace:', error);
      const status = document.getElementById('save-status');
      if (status) {
        status.textContent = 'Local save failed';
        status.className = 'flex items-center gap-1.5 text-red-400';
      }
      if (showFailureToast) this.showToast('Could not save this workspace. Export a backup and free browser storage.', 'warning');
      return false;
    }
  }

  persistInitialWorkspace() {
    let legacyData = null;
    try {
      legacyData = localStorage.getItem(this.STORAGE_KEY);
    } catch (error) {
      console.warn('Could not inspect the previous resume backup:', error);
    }
    let saved = this.writeWorkspace(false);
    if (!saved && legacyData) {
      try {
        localStorage.removeItem(this.STORAGE_KEY);
        saved = this.writeWorkspace();
        if (!saved) localStorage.setItem(this.STORAGE_KEY, legacyData);
      } catch (error) {
        console.warn('Could not complete the resume workspace migration:', error);
      }
    } else if (saved && legacyData) {
      try {
        localStorage.removeItem(this.STORAGE_KEY);
      } catch (error) {
        console.warn('Could not remove the migrated resume backup key:', error);
      }
    }
    if (saved) {
      const status = document.getElementById('save-status');
      if (status) {
        status.textContent = 'Auto-saved to local browser storage';
        status.className = 'flex items-center gap-1.5';
      }
    } else if (!legacyData) {
      this.showToast('Could not save this workspace. Export a backup and free browser storage.', 'warning');
    }
  }

  loadState() {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      if (saved) {
        return this.normalizeState(JSON.parse(saved));
      }
    } catch (e) {
      console.warn('Failed to load saved state from localStorage:', e);
    }
    // Deep clone initial data
    return this.normalizeState(JSON.parse(JSON.stringify(INITIAL_DATA)));
  }

  normalizeState(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const initial = JSON.parse(JSON.stringify(INITIAL_DATA));
    const theme = { ...initial.theme, ...(source.theme && typeof source.theme === 'object' ? source.theme : {}) };
    const personal = { ...initial.personal, ...(source.personal && typeof source.personal === 'object' ? source.personal : {}) };

    const copyArray = (key) => Array.isArray(source[key])
      ? source[key].filter(item => item && typeof item === 'object')
      : initial[key];
    return {
      theme,
      personal,
      experiences: copyArray('experiences'),
      education: copyArray('education'),
      skills: copyArray('skills'),
      projects: copyArray('projects'),
      certifications: copyArray('certifications'),
      languages: copyArray('languages'),
      customSections: copyArray('customSections'),
      targetJobDescription: typeof source.targetJobDescription === 'string' ? source.targetJobDescription : ''
    };
  }

  saveState() {
    if (!this.isRestoringHistory) this.scheduleHistorySnapshot();
    const activeApplication = this.activeApplicationId
      ? this.applications.find(application => application.id === this.activeApplicationId)
      : null;
    if (activeApplication) {
      activeApplication.resume = this.cloneResume(this.state);
      activeApplication.jobDescription = this.state.targetJobDescription;
    }
    else this.masterState = this.cloneResume(this.state);

    try {
      if (this.writeWorkspace()) {
        this.saveIndicatorTimer?.();
        const status = document.getElementById('save-status');
        if (status) status.className = 'flex items-center gap-1.5';
      }
    } catch (e) {
      console.warn('Failed to save to localStorage:', e);
      const status = document.getElementById('save-status');
      if (status) {
        status.textContent = 'Local save failed';
        status.className = 'flex items-center gap-1.5 text-red-400';
      }
    }
    this.renderPreview();
    this.updateAtsScore();
  }

  scheduleHistorySnapshot() {
    window.clearTimeout(this.historyTimer);
    this.historyTimer = window.setTimeout(() => this.commitHistorySnapshot(), 600);
  }

  commitHistorySnapshot() {
    window.clearTimeout(this.historyTimer);
    this.historyTimer = null;
    const snapshot = JSON.stringify(this.state);
    if (snapshot === this.history[this.historyIndex]) return;

    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(snapshot);
    if (this.history.length > 50) this.history.shift();
    this.historyIndex = this.history.length - 1;
    this.updateHistoryControls();
  }

  resetHistory() {
    window.clearTimeout(this.historyTimer);
    this.historyTimer = null;
    this.history = [JSON.stringify(this.state)];
    this.historyIndex = 0;
    this.updateHistoryControls();
  }

  updateHistoryControls() {
    const undoButton = document.getElementById('btn-undo');
    const redoButton = document.getElementById('btn-redo');
    if (undoButton) undoButton.disabled = this.historyIndex <= 0;
    if (redoButton) redoButton.disabled = this.historyIndex >= this.history.length - 1;
  }

  setupHistoryControls() {
    document.getElementById('btn-undo')?.addEventListener('click', () => this.undo());
    document.getElementById('btn-redo')?.addEventListener('click', () => this.redo());
    this.updateHistoryControls();
  }

  undo() {
    window.clearTimeout(this.historyTimer);
    this.historyTimer = null;
    this.commitHistorySnapshot();
    if (this.historyIndex <= 0) return;
    this.restoreHistorySnapshot(this.historyIndex - 1);
  }

  redo() {
    window.clearTimeout(this.historyTimer);
    this.historyTimer = null;
    if (this.historyIndex >= this.history.length - 1) return;
    this.restoreHistorySnapshot(this.historyIndex + 1);
  }

  restoreHistorySnapshot(index) {
    const direction = index < this.historyIndex ? 'Change undone' : 'Change restored';
    this.isRestoringHistory = true;
    try {
      this.state = this.normalizeState(JSON.parse(this.history[index]));
      this.historyIndex = index;
      const personal = this.state.personal;
      ['fullName', 'jobTitle', 'email', 'phone', 'location', 'website', 'linkedin', 'github', 'summary'].forEach(field => {
        const input = document.getElementById(`input-${field}`);
        if (input) input.value = personal[field] || '';
      });

      const photoPreview = document.getElementById('photo-avatar-preview');
      const photoInput = document.getElementById('photo-upload-input');
      if (photoPreview) {
        photoPreview.src = personal.photo || '';
        photoPreview.classList.toggle('hidden', !personal.photo);
      }
      if (photoInput) photoInput.value = '';
      this.refreshDynamicEditorLists();
      this.setupThemeControls();
      this.saveState();
      this.updateHistoryControls();
    } finally {
      this.isRestoringHistory = false;
    }
    this.showToast(direction);
  }

  refreshDynamicEditorLists() {
    this.renderExperienceList();
    this.renderEducationList();
    this.renderSkillsList();
    this.renderProjectsList();
    this.renderCertificationsList();
    this.renderLanguagesList();
    this.renderCustomSectionsList();
    const jobDescriptionInput = document.getElementById('input-job-description');
    if (jobDescriptionInput) jobDescriptionInput.value = this.state.targetJobDescription || '';
    this.updateJobMatch();
  }

  setupJobMatch() {
    const input = document.getElementById('input-job-description');
    if (!input) return;
    input.value = this.state.targetJobDescription || '';
    input.addEventListener('input', () => {
      this.state.targetJobDescription = input.value;
      this.saveState();
    });
    document.getElementById('btn-clear-job-description')?.addEventListener('click', () => {
      input.value = '';
      this.state.targetJobDescription = '';
      this.saveState();
      input.focus();
    });
    this.updateJobMatch();
  }

  updateJobMatch() {
    const scoreEl = document.getElementById('job-match-score');
    const summaryEl = document.getElementById('job-match-summary');
    const keywordsEl = document.getElementById('job-match-keywords');
    if (!scoreEl || !summaryEl || !keywordsEl) return;

    const description = (this.state.targetJobDescription || '').toLowerCase();
    const counts = new Map();
    const tokens = (description.match(/[a-z][a-z0-9+#.-]{2,}/g) || []).map(token => token.replace(/[.-]+$/, ''));
    tokens.forEach(token => {
      if (!JOB_STOP_WORDS.has(token)) counts.set(token, (counts.get(token) || 0) + 1);
    });
    const keywords = [...counts.keys()]
      .sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b))
      .slice(0, 30);

    if (description.trim().length < 40 || keywords.length < 3) {
      scoreEl.textContent = description.trim() ? 'Add more text' : 'Add a job post';
      summaryEl.textContent = 'Paste a job description (at least a few sentences) to compare key terms.';
      keywordsEl.replaceChildren();
      return;
    }

    const resumeText = JSON.stringify({
      personal: this.state.personal,
      experiences: this.state.experiences,
      education: this.state.education,
      skills: this.state.skills,
      projects: this.state.projects,
      certifications: this.state.certifications,
      languages: this.state.languages,
      customSections: this.state.customSections
    }).toLowerCase();
    const resumeTerms = new Set((resumeText.match(/[a-z][a-z0-9+#.-]{2,}/g) || []).map(term => term.replace(/[.-]+$/, '')));
    const matched = keywords.filter(keyword => resumeTerms.has(keyword));
    const missing = keywords.filter(keyword => !resumeTerms.has(keyword));
    const score = Math.round((matched.length / keywords.length) * 100);

    scoreEl.textContent = `${score}% match`;
    summaryEl.textContent = `${matched.length} of ${keywords.length} frequent job-post terms appear in your resume. Only add missing terms if they accurately describe your experience.`;
    keywordsEl.innerHTML = [
      ...matched.slice(0, 8).map(term => `<span class="keyword-chip keyword-chip-matched">✓ ${escapeHtml(term)}</span>`),
      ...missing.slice(0, 12).map(term => `<span class="keyword-chip">+ ${escapeHtml(term)}</span>`)
    ].join('');
  }

  setupAppearance() {
    try {
      this.appearance = localStorage.getItem('resumecraft_appearance_v1') === 'dark' ? 'dark' : 'light';
    } catch (error) {
      console.warn('Could not read the appearance preference:', error);
      this.appearance = 'light';
    }

    const applyAppearance = () => {
      document.documentElement.classList.toggle('theme-light', this.appearance === 'light');
      document.documentElement.classList.toggle('theme-dark', this.appearance === 'dark');
      document.body.classList.toggle('theme-light', this.appearance === 'light');
      document.body.classList.toggle('theme-dark', this.appearance === 'dark');
      document.querySelectorAll('.theme-toggle').forEach(button => {
        const label = this.appearance === 'light' ? 'Dark mode' : 'Light mode';
        button.textContent = label;
        button.setAttribute('aria-label', `Switch to ${this.appearance === 'light' ? 'dark' : 'light'} mode`);
      });
    };

    applyAppearance();
    document.querySelectorAll('.theme-toggle').forEach(button => {
      button.addEventListener('click', () => {
        this.appearance = this.appearance === 'light' ? 'dark' : 'light';
        applyAppearance();
        try {
          localStorage.setItem('resumecraft_appearance_v1', this.appearance);
        } catch (error) {
          console.warn('Could not save the appearance preference:', error);
          this.showToast('Theme changed, but could not be saved in this browser.', 'warning');
        }
      });
    });
  }

  setupDashboard() {
    document.getElementById('btn-open-dashboard')?.addEventListener('click', () => this.showDashboard());
    document.getElementById('btn-dashboard-master')?.addEventListener('click', () => this.openMasterResume());
    document.getElementById('btn-dashboard-new')?.addEventListener('click', () => this.openApplicationModal());
    document.querySelector('[data-open-new-application]')?.addEventListener('click', () => this.openApplicationModal());
    document.getElementById('application-filter')?.addEventListener('change', () => this.renderDashboard());
    document.getElementById('application-list')?.addEventListener('click', event => this.handleApplicationAction(event));
    document.getElementById('application-list')?.addEventListener('change', event => this.handleApplicationStageChange(event));

    const form = document.getElementById('application-form');
    form?.addEventListener('submit', event => this.saveApplicationForm(event));
    document.getElementById('btn-close-application-modal')?.addEventListener('click', () => this.closeApplicationModal());
    document.getElementById('btn-cancel-application')?.addEventListener('click', () => this.closeApplicationModal());
    document.getElementById('application-modal')?.addEventListener('click', event => {
      if (event.target.id === 'application-modal') this.closeApplicationModal();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !document.getElementById('application-modal')?.classList.contains('hidden')) {
        this.closeApplicationModal();
      }
    });

    document.getElementById('btn-enable-reminders')?.addEventListener('click', () => this.enableReminders());
    document.getElementById('btn-export-workspace')?.addEventListener('click', () => this.exportWorkspace());
    const importButton = document.getElementById('btn-import-workspace');
    const importInput = document.getElementById('workspace-import-input');
    importButton?.addEventListener('click', () => importInput?.click());
    importInput?.addEventListener('change', event => this.importWorkspaceFile(event));

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !document.getElementById('dashboard-screen')?.classList.contains('hidden')) {
        this.checkDeadlineReminders();
      }
    });
    this.reminderTimer = window.setInterval(() => {
      if (!document.hidden && !document.getElementById('dashboard-screen')?.classList.contains('hidden')) {
        this.checkDeadlineReminders();
      }
    }, 30 * 60 * 1000);
    this.renderDashboard();
  }

  updateWorkspaceLabel() {
    const label = document.getElementById('active-workspace-label');
    if (!label) return;
    const application = this.activeApplicationId
      ? this.applications.find(item => item.id === this.activeApplicationId)
      : null;
    label.textContent = application ? `${application.role} · ${application.company}` : 'Master resume';
  }

  showDashboard() {
    document.getElementById('dashboard-screen')?.classList.remove('hidden');
    document.getElementById('app-header')?.classList.add('hidden');
    document.getElementById('app-workspace')?.classList.add('hidden');
    this.renderDashboard();
    this.checkDeadlineReminders();
  }

  showEditor() {
    document.getElementById('dashboard-screen')?.classList.add('hidden');
    document.getElementById('app-header')?.classList.remove('hidden');
    document.getElementById('app-workspace')?.classList.remove('hidden');
    this.updateWorkspaceLabel();
  }

  openMasterResume() {
    this.activateWorkspace(null);
  }

  openApplicationResume(applicationId) {
    if (!this.applications.some(application => application.id === applicationId)) {
      this.showToast('That application workspace could not be found.', 'warning');
      this.renderDashboard();
      return;
    }
    this.activateWorkspace(applicationId);
  }

  activateWorkspace(applicationId) {
    this.activeApplicationId = applicationId;
    const application = applicationId
      ? this.applications.find(item => item.id === applicationId)
      : null;
    this.state = this.cloneResume(application ? application.resume : this.masterState);
    this.history = [JSON.stringify(this.state)];
    this.historyIndex = 0;
    this.isRestoringHistory = false;
    window.clearTimeout(this.historyTimer);
    this.populateEditorForms();
    this.setupThemeControls();
    this.renderPreview();
    this.updateAtsScore();
    this.updateJobMatch();
    this.updateHistoryControls();
    this.showEditor();
  }

  openApplicationModal(application = null) {
    const form = document.getElementById('application-form');
    const modal = document.getElementById('application-modal');
    if (!form || !modal) return;
    form.reset();
    document.getElementById('application-id').value = application?.id || '';
    document.getElementById('application-company').value = application?.company || '';
    document.getElementById('application-role').value = application?.role || '';
    document.getElementById('application-url').value = application?.url || '';
    document.getElementById('application-stage').value = application?.stage || 'Saved';
    document.getElementById('application-deadline').value = application?.deadline || '';
    document.getElementById('application-description').value = application?.jobDescription || '';
    document.getElementById('application-notes').value = application?.notes || '';
    document.getElementById('application-modal-title').textContent = application ? 'Edit application' : 'New application';
    document.getElementById('application-form-error')?.classList.add('hidden');
    modal.classList.remove('hidden');
    document.getElementById('application-company')?.focus();
  }

  closeApplicationModal() {
    document.getElementById('application-modal')?.classList.add('hidden');
  }

  saveApplicationForm(event) {
    event.preventDefault();
    const errorEl = document.getElementById('application-form-error');
    const company = document.getElementById('application-company').value.trim();
    const role = document.getElementById('application-role').value.trim();
    const url = document.getElementById('application-url').value.trim();
    if (!company || !role) {
      this.showApplicationFormError('Add both a company and role to continue.');
      return;
    }
    if (url) {
      try {
        const parsedUrl = new URL(url);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('Unsupported protocol');
      } catch {
        this.showApplicationFormError('Enter a valid http or https job post link.');
        return;
      }
    }

    const existingId = document.getElementById('application-id').value;
    const existing = existingId ? this.applications.find(item => item.id === existingId) : null;
    if (existingId && !existing) {
      this.showApplicationFormError('This application no longer exists. Close this form and try again.');
      return;
    }
    const application = {
      ...(existing || {}),
      id: existing?.id || `application-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      company,
      role,
      url,
      stage: APPLICATION_STAGES.includes(document.getElementById('application-stage').value)
        ? document.getElementById('application-stage').value : 'Saved',
      deadline: document.getElementById('application-deadline').value,
      jobDescription: document.getElementById('application-description').value.trim(),
      notes: document.getElementById('application-notes').value.trim(),
      createdAt: existing?.createdAt || Date.now(),
      lastReminderDate: existing?.lastReminderDate || '',
      resume: existing ? existing.resume : this.cloneResume(this.masterState)
    };
    application.resume.targetJobDescription = application.jobDescription;

    if (existing) {
      this.applications = this.applications.map(item => item.id === existing.id ? application : item);
    } else {
      this.applications.unshift(application);
    }
    if (!this.writeWorkspace()) return;
    this.closeApplicationModal();
    this.renderDashboard();
    this.showToast(existing ? 'Application updated' : 'Application workspace created', 'success');
    if (!existing) this.openApplicationResume(application.id);
  }

  showApplicationFormError(message) {
    const errorEl = document.getElementById('application-form-error');
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
  }

  handleApplicationAction(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const card = button.closest('[data-application-id]');
    const application = this.applications.find(item => item.id === card?.dataset.applicationId);
    if (!application) return;
    switch (button.dataset.action) {
      case 'open':
        this.openApplicationResume(application.id);
        break;
      case 'edit':
        this.openApplicationModal(application);
        break;
      case 'delete':
        if (window.confirm(`Delete the ${application.role} application at ${application.company}? Its tailored resume will also be removed.`)) {
          this.applications = this.applications.filter(item => item.id !== application.id);
          if (!this.writeWorkspace()) return;
          if (this.activeApplicationId === application.id) {
            this.activeApplicationId = null;
            this.state = this.cloneResume(this.masterState);
            this.updateWorkspaceLabel();
          }
          this.renderDashboard();
          this.showToast('Application deleted');
        }
        break;
      case 'visit':
        if (application.url) window.open(application.url, '_blank', 'noopener,noreferrer');
        break;
    }
  }

  handleApplicationStageChange(event) {
    const select = event.target.closest('[data-application-stage]');
    if (!select) return;
    const card = select.closest('[data-application-id]');
    const application = this.applications.find(item => item.id === card?.dataset.applicationId);
    if (!application || !APPLICATION_STAGES.includes(select.value)) return;
    application.stage = select.value;
    if (!this.writeWorkspace()) return;
    this.renderDashboard();
    this.showToast('Application stage updated', 'success');
  }

  renderDashboard() {
    const list = document.getElementById('application-list');
    if (!list) return;
    const filter = document.getElementById('application-filter')?.value || 'all';
    const visibleApplications = this.applications.filter(application => {
      if (filter === 'active') return application.stage !== 'Closed';
      if (filter === 'closed') return application.stage === 'Closed';
      return true;
    });
    const activeCount = this.applications.filter(application => application.stage !== 'Closed').length;
    const interviewCount = this.applications.filter(application => application.stage === 'Interview').length;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const upcomingCount = this.applications.filter(application => {
      if (!application.deadline || application.stage === 'Closed') return false;
      const deadline = new Date(`${application.deadline}T00:00:00`);
      const days = Math.round((deadline - today) / 86400000);
      return days >= 0 && days <= 7;
    }).length;
    document.getElementById('stat-active-apps').textContent = activeCount;
    document.getElementById('stat-interviews').textContent = interviewCount;
    document.getElementById('stat-upcoming').textContent = upcomingCount;

    list.innerHTML = visibleApplications.map(application => {
      const deadlineDate = application.deadline ? new Date(`${application.deadline}T00:00:00`) : null;
      const deadlineDays = deadlineDate ? Math.round((deadlineDate - today) / 86400000) : null;
      const deadlineText = deadlineDate
        ? (deadlineDays < 0
          ? `Overdue by ${Math.abs(deadlineDays)} day${deadlineDays === -1 ? '' : 's'}`
          : `Deadline ${deadlineDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`)
        : 'No deadline';
      const deadlineClass = deadlineDays !== null && deadlineDays < 0
        ? 'deadline-overdue'
        : deadlineDays !== null && deadlineDays <= 2 ? 'deadline-soon' : '';
      const safeUrl = this.safeHttpUrl(application.url);
      const notes = application.notes ? escapeHtml(application.notes).replace(/\n/g, ' ') : 'Add notes to keep your next step close at hand.';
      return `
        <article class="application-card" data-application-id="${escapeHtml(application.id)}">
          <div class="application-card-top">
            <div>
              <h3>${escapeHtml(application.role || 'Untitled role')}</h3>
              <p class="application-company">${escapeHtml(application.company || 'Company not set')}</p>
            </div>
            <select class="application-stage" data-application-stage aria-label="Stage for ${escapeHtml(application.company)}">
              ${APPLICATION_STAGES.map(stage => `<option value="${stage}" ${application.stage === stage ? 'selected' : ''}>${stage}</option>`).join('')}
            </select>
          </div>
          <div class="application-card-meta">
            <span class="${deadlineClass}">${deadlineText}</span>
            ${safeUrl ? '<span>Job post saved</span>' : '<span>Resume tailored workspace</span>'}
          </div>
          <p class="application-notes-preview">${notes}</p>
          <div class="application-card-footer">
            <span class="dashboard-caption">Created ${new Date(application.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            <div class="application-card-actions">
              <button type="button" class="dashboard-card-button" data-action="open">Open resume</button>
              ${safeUrl ? '<button type="button" class="dashboard-card-button" data-action="visit">Job post</button>' : ''}
              <button type="button" class="dashboard-card-button" data-action="edit">Edit</button>
              <button type="button" class="dashboard-card-button danger" data-action="delete">Delete</button>
            </div>
          </div>
        </article>`;
    }).join('');

    const emptyState = document.getElementById('dashboard-empty-state');
    emptyState?.classList.toggle('hidden', this.applications.length > 0);
    list.classList.toggle('hidden', visibleApplications.length === 0);
    if (emptyState && this.applications.length > 0 && visibleApplications.length === 0) {
      emptyState.classList.remove('hidden');
      emptyState.querySelector('h2').textContent = 'No applications in this view.';
      emptyState.querySelector('p').textContent = 'Choose a different filter to see your saved opportunities.';
      emptyState.querySelector('[data-open-new-application]')?.classList.add('hidden');
    } else if (emptyState) {
      emptyState.querySelector('h2').textContent = 'Your next chapter starts here.';
      emptyState.querySelector('p').textContent = 'Create an application workspace to keep a job post, tailored resume, notes, and deadline together.';
      emptyState.querySelector('[data-open-new-application]')?.classList.remove('hidden');
    }
    this.updateReminderButton();
    this.initLucide();
  }

  safeHttpUrl(value) {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  updateReminderButton() {
    const button = document.getElementById('btn-enable-reminders');
    const available = 'Notification' in window && Notification.permission === 'granted';
    if (button) button.textContent = this.notificationsEnabled && available ? 'Reminders on' : 'Enable reminders';
  }

  async enableReminders() {
    if (!('Notification' in window)) {
      this.showToast('Browser reminders are not supported here.', 'warning');
      return;
    }
    if (!window.isSecureContext) {
      this.showToast('Reminders need a secure page (HTTPS or localhost).', 'warning');
      return;
    }
    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      this.notificationsEnabled = false;
      this.writeWorkspace();
      this.updateReminderButton();
      this.showToast('Notifications were not enabled. You can still track deadlines here.');
      return;
    }
    this.notificationsEnabled = true;
    if (!this.writeWorkspace()) {
      this.notificationsEnabled = false;
      return;
    }
    this.updateReminderButton();
    this.showToast('Reminders enabled while this page is open.', 'success');
    this.checkDeadlineReminders();
  }

  checkDeadlineReminders() {
    if (!this.notificationsEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    let changed = false;
    this.applications.forEach(application => {
      if (!application.deadline || application.stage === 'Closed' || application.lastReminderDate === todayKey) return;
      const deadline = new Date(`${application.deadline}T00:00:00`);
      const days = Math.round((deadline - today) / 86400000);
      if (days < 0 || days > 2) return;
      const when = days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`;
      new Notification(`Application deadline ${when}`, {
        body: `${application.role} at ${application.company}`,
        tag: application.id
      });
      application.lastReminderDate = todayKey;
      changed = true;
    });
    if (changed) this.writeWorkspace();
  }

  exportWorkspace() {
    const content = JSON.stringify({
      version: 1,
      masterResume: this.masterState,
      applications: this.applications,
      notificationsEnabled: this.notificationsEnabled
    }, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'resumecraft-workspace.json';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.showToast('Workspace backup downloaded', 'success');
  }

  async importWorkspaceFile(event) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';
    if (file.size > 10 * 1024 * 1024) {
      this.showToast('Workspace backup must be smaller than 10 MB.', 'warning');
      return;
    }
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || parsed.version !== 1 || !parsed.masterResume || typeof parsed.masterResume !== 'object' ||
          !Array.isArray(parsed.applications) || parsed.applications.length > 500 ||
          parsed.applications.some(application => !application || typeof application !== 'object' ||
            typeof application.company !== 'string' || typeof application.role !== 'string')) {
        throw new Error('The selected file is not a supported ResumeCraft workspace backup.');
      }
      const masterResume = this.normalizeState(parsed.masterResume);
      const applications = parsed.applications.map(application => this.normalizeApplication(application, masterResume));
      if (!window.confirm('Replace this browser’s Master resume and all application workspaces with the backup? This cannot be undone.')) return;
      this.masterState = masterResume;
      this.applications = applications;
      this.notificationsEnabled = parsed.notificationsEnabled === true &&
        'Notification' in window && Notification.permission === 'granted';
      this.activeApplicationId = null;
      this.state = this.cloneResume(masterResume);
      if (!this.writeWorkspace()) return;
      localStorage.removeItem(this.STORAGE_KEY);
      this.history = [JSON.stringify(this.state)];
      this.historyIndex = 0;
      this.populateEditorForms();
      this.setupThemeControls();
      this.renderPreview();
      this.updateAtsScore();
      this.updateJobMatch();
      this.updateHistoryControls();
      this.renderDashboard();
      this.showToast('Workspace backup imported', 'success');
    } catch (error) {
      console.warn('Failed to import workspace backup:', error);
      this.showToast(error instanceof SyntaxError ? 'The selected file is not valid JSON.' : error.message || 'Could not import this workspace.', 'warning');
    }
  }

  init() {
    this.setupAppearance();
    this.setupThemeControls();
    this.setupTabNavigation();
    this.setupZoomControls();
    this.setupKeyboardShortcuts();
    this.setupHistoryControls();
    this.setupSaveIndicator();
    this.populateEditorForms();
    this.setupJobMatch();
    this.setupEventDelegation();
    this.setupAtsModal();
    this.setupExportImport();
    this.setupDashboard();
    this.renderPreview();
    this.updateAtsScore();
    this.initLucide();
    this.persistInitialWorkspace();
    this.updateWorkspaceLabel();
    if (this.openDashboardOnLoad) this.showDashboard();
  }

  initLucide() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  // ----------------------------------------------------
  // Live Preview Rendering & Typography
  // ----------------------------------------------------
  renderPreview() {
    const container = document.getElementById('resume-container');
    const paper = document.getElementById('resume-paper');
    if (!container || !paper) return;

    // Apply template HTML
    container.innerHTML = renderResume(this.state);

    // Apply typography & spacing classes to paper
    const theme = this.state.theme || {};
    
    // Clear old font and spacing classes
    paper.className = 'resume-paper';
    
    // Add font family class
    const fontClass = `font-${(theme.fontFamily || 'Inter').replace(/\s+/g, '-')}`;
    paper.classList.add(fontClass);

    // Add font size class
    paper.classList.add(`font-size-${theme.fontSize || 'medium'}`);

    // Add spacing density class
    paper.classList.add(`spacing-${theme.spacing || 'normal'}`);

    // Update zoom transform
    this.applyZoom();
  }

  applyZoom() {
    const wrapper = document.getElementById('resume-paper-wrapper');
    if (wrapper) {
      wrapper.style.transform = `scale(${this.zoomLevel})`;
    }
    const zoomText = document.getElementById('zoom-percentage');
    if (zoomText) {
      zoomText.textContent = `${Math.round(this.zoomLevel * 100)}%`;
    }
  }

  showToast(message, tone = 'neutral') {
    const stack = document.getElementById('toast-stack');
    if (!stack) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    if (tone === 'success') toast.style.borderColor = 'rgba(16, 185, 129, 0.55)';
    if (tone === 'warning') toast.style.borderColor = 'rgba(245, 158, 11, 0.55)';
    stack.appendChild(toast);
    window.setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(6px)';
      toast.style.transition = 'all 0.2s ease';
      window.setTimeout(() => toast.remove(), 220);
    }, 2800);
  }

  setupSaveIndicator() {
    let saveTimer = null;
    this.saveIndicatorTimer = () => {
      const status = document.getElementById('save-status');
      if (!status) return;
      status.textContent = 'Saving changes...';
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        status.textContent = 'All changes saved';
      }, 450);
    };
  }

  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) this.redo();
        else this.undo();
        return;
      }
      if (key === 'y') {
        event.preventDefault();
        this.redo();
        return;
      }
      if (key === 'p') {
        event.preventDefault();
        window.print();
      }
      if (key === 's') {
        event.preventDefault();
        document.getElementById('btn-export-json')?.click();
      }
    });
  }

  setupZoomControls() {
    document.getElementById('zoom-in-btn')?.addEventListener('click', () => {
      this.zoomLevel = Math.min(1.4, this.zoomLevel + 0.1);
      this.applyZoom();
    });

    document.getElementById('zoom-out-btn')?.addEventListener('click', () => {
      this.zoomLevel = Math.max(0.4, this.zoomLevel - 0.1);
      this.applyZoom();
    });

    document.getElementById('zoom-fit-btn')?.addEventListener('click', () => {
      const viewport = document.getElementById('preview-viewport');
      if (viewport) {
        // 210mm in pixels at 96dpi is ~794px + padding
        const viewportWidth = viewport.clientWidth - 48;
        this.zoomLevel = Math.min(1.0, Math.max(0.4, viewportWidth / 820));
        this.applyZoom();
      }
    });

    // Mobile View Toggle Tabs
    const mobileTabEditor = document.getElementById('mobile-tab-editor');
    const mobileTabPreview = document.getElementById('mobile-tab-preview');
    const editorPanel = document.getElementById('editor-panel');
    const previewViewport = document.getElementById('preview-viewport');

    mobileTabEditor?.addEventListener('click', () => {
      editorPanel.classList.remove('hidden');
      previewViewport.classList.add('hidden');
      mobileTabEditor.classList.add('bg-blue-600', 'text-white');
      mobileTabPreview.classList.remove('bg-blue-600', 'text-white');
    });

    mobileTabPreview?.addEventListener('click', () => {
      editorPanel.classList.add('hidden');
      previewViewport.classList.remove('hidden');
      mobileTabPreview.classList.add('bg-blue-600', 'text-white');
      mobileTabEditor.classList.remove('bg-blue-600', 'text-white');
      // Trigger fit
      document.getElementById('zoom-fit-btn')?.click();
    });

    const syncDesktopLayout = () => {
      if (window.innerWidth >= 1024 && editorPanel && previewViewport) {
        editorPanel.classList.remove('hidden');
        previewViewport.classList.remove('hidden');
      }
    };
    window.addEventListener('resize', syncDesktopLayout);
    syncDesktopLayout();

    document.getElementById('preview-fullscreen-btn')?.addEventListener('click', () => {
      const workspace = document.querySelector('.preview-viewport')?.parentElement;
      workspace?.classList.toggle('preview-focus');
      requestAnimationFrame(() => document.getElementById('zoom-fit-btn')?.click());
    });
  }

  // ----------------------------------------------------
  // Navigation Tabs (Personal, Experience, Skills, etc.)
  // ----------------------------------------------------
  setupTabNavigation() {
    const tabs = document.querySelectorAll('.editor-tab');
    const panels = document.querySelectorAll('.tab-panel');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTab = tab.getAttribute('data-tab');
        this.currentTab = targetTab;

        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        panels.forEach(p => {
          if (p.id === `tab-${targetTab}`) {
            p.classList.remove('hidden');
          } else {
            p.classList.add('hidden');
          }
        });
      });
    });
  }

  // ----------------------------------------------------
  // Theme & Styling Controls
  // ----------------------------------------------------
  setupThemeControls() {
    const theme = this.state.theme || {};

    if (this.themeControlsInitialized) {
      const templateButtons = document.querySelectorAll('.template-btn');
      templateButtons.forEach(btn => {
        btn.classList.toggle('ring-2', btn.getAttribute('data-template') === theme.template);
        btn.classList.toggle('ring-blue-500', btn.getAttribute('data-template') === theme.template);
        btn.classList.toggle('border-blue-500', btn.getAttribute('data-template') === theme.template);
      });
      const paletteContainer = document.getElementById('color-palettes-container');
      paletteContainer?.querySelectorAll('.color-swatch').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-color')?.toLowerCase() === (theme.primaryColor || '').toLowerCase());
      });
      const hexInput = document.getElementById('custom-color-input');
      if (hexInput) hexInput.value = theme.primaryColor || '#2563eb';
      const fontSelect = document.getElementById('font-family-select');
      if (fontSelect) fontSelect.value = theme.fontFamily || 'Inter';
      const fontSizeSelect = document.getElementById('font-size-select');
      if (fontSizeSelect) fontSizeSelect.value = theme.fontSize || 'medium';
      const spacingSelect = document.getElementById('spacing-select');
      if (spacingSelect) spacingSelect.value = theme.spacing || 'normal';
      const showPhotoToggle = document.getElementById('toggle-show-photo');
      if (showPhotoToggle) showPhotoToggle.checked = theme.showPhoto !== false;
      return;
    }
    this.themeControlsInitialized = true;

    // Template selector buttons
    const templateButtons = document.querySelectorAll('.template-btn');
    templateButtons.forEach(btn => {
      const tmpl = btn.getAttribute('data-template');
      if (tmpl === theme.template) {
        btn.classList.add('ring-2', 'ring-blue-500', 'border-blue-500');
      }
      btn.addEventListener('click', () => {
        templateButtons.forEach(b => b.classList.remove('ring-2', 'ring-blue-500', 'border-blue-500'));
        btn.classList.add('ring-2', 'ring-blue-500', 'border-blue-500');
        this.state.theme.template = tmpl;
        this.saveState();
      });
    });

    // Color Swatches
    const paletteContainer = document.getElementById('color-palettes-container');
    if (paletteContainer) {
      paletteContainer.innerHTML = COLOR_PALETTES.map(p => `
        <button 
          type="button" 
          class="color-swatch ${theme.primaryColor.toLowerCase() === p.hex.toLowerCase() ? 'active' : ''}" 
          style="background-color: ${p.hex};" 
          data-color="${p.hex}" 
          title="${p.name}">
        </button>
      `).join('');

      paletteContainer.querySelectorAll('.color-swatch').forEach(btn => {
        btn.addEventListener('click', () => {
          paletteContainer.querySelectorAll('.color-swatch').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const hex = btn.getAttribute('data-color');
          this.state.theme.primaryColor = hex;
          const hexInput = document.getElementById('custom-color-input');
          if (hexInput) hexInput.value = hex;
          this.saveState();
        });
      });
    }

    // Custom Hex Color Input
    const hexInput = document.getElementById('custom-color-input');
    if (hexInput) {
      hexInput.value = theme.primaryColor || '#2563eb';
      hexInput.addEventListener('input', (e) => {
        this.state.theme.primaryColor = e.target.value;
        this.saveState();
      });
    }

    // Font Family Select
    const fontSelect = document.getElementById('font-family-select');
    if (fontSelect) {
      fontSelect.innerHTML = FONT_OPTIONS.map(f => `
        <option value="${f.id}" ${theme.fontFamily === f.id ? 'selected' : ''}>${f.name}</option>
      `).join('');
      fontSelect.addEventListener('change', (e) => {
        this.state.theme.fontFamily = e.target.value;
        this.saveState();
      });
    }

    // Font Size Radio/Select
    const fontSizeSelect = document.getElementById('font-size-select');
    if (fontSizeSelect) {
      fontSizeSelect.value = theme.fontSize || 'medium';
      fontSizeSelect.addEventListener('change', (e) => {
        this.state.theme.fontSize = e.target.value;
        this.saveState();
      });
    }

    // Spacing Density Select
    const spacingSelect = document.getElementById('spacing-select');
    if (spacingSelect) {
      spacingSelect.value = theme.spacing || 'normal';
      spacingSelect.addEventListener('change', (e) => {
        this.state.theme.spacing = e.target.value;
        this.saveState();
      });
    }

    // Photo Visibility Toggle
    const showPhotoToggle = document.getElementById('toggle-show-photo');
    if (showPhotoToggle) {
      showPhotoToggle.checked = theme.showPhoto !== false;
      showPhotoToggle.addEventListener('change', (e) => {
        this.state.theme.showPhoto = e.target.checked;
        this.saveState();
      });
    }
  }

  // ----------------------------------------------------
  // Form Populations & Bindings
  // ----------------------------------------------------
  populateEditorForms() {
    this.populatePersonalForm();
    this.renderExperienceList();
    this.renderEducationList();
    this.renderSkillsList();
    this.renderProjectsList();
    this.renderCertificationsList();
    this.renderLanguagesList();
    this.renderCustomSectionsList();
    this.populateHelperChips();
    const jobDescriptionInput = document.getElementById('input-job-description');
    if (jobDescriptionInput) jobDescriptionInput.value = this.state.targetJobDescription || '';
  }

  populatePersonalForm() {
    const p = this.state.personal || {};
    const fields = ['fullName', 'jobTitle', 'email', 'phone', 'location', 'website', 'linkedin', 'github', 'summary'];
    const shouldBindInputs = !this.personalInputsBound;
    
    fields.forEach(field => {
      const el = document.getElementById(`input-${field}`);
      if (el) {
        el.value = p[field] || '';
        if (shouldBindInputs) {
          el.addEventListener('input', (e) => {
            this.state.personal[field] = e.target.value;
            this.saveState();
          });
        }
      }
    });

    // Photo input
    const photoInput = document.getElementById('photo-upload-input');
    const photoPreview = document.getElementById('photo-avatar-preview');
    const removePhotoBtn = document.getElementById('remove-photo-btn');

    if (photoPreview) {
      photoPreview.src = p.photo || '';
      photoPreview.classList.toggle('hidden', !p.photo);
    }
    if (photoInput) photoInput.value = '';

    if (shouldBindInputs) {
      photoInput?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          if (!file.type.startsWith('image/')) {
            alert('Please choose a valid image file.');
            e.target.value = '';
            return;
          }
          if (file.size > 2 * 1024 * 1024) {
            alert('Profile photos must be smaller than 2 MB.');
            e.target.value = '';
            return;
          }
          const reader = new FileReader();
          reader.onload = (event) => {
            this.state.personal.photo = event.target.result;
            if (photoPreview) {
              photoPreview.src = event.target.result;
              photoPreview.classList.remove('hidden');
            }
            this.saveState();
          };
          reader.readAsDataURL(file);
        };
      });

      removePhotoBtn?.addEventListener('click', () => {
        this.state.personal.photo = '';
        if (photoPreview) {
          photoPreview.src = '';
          photoPreview.classList.add('hidden');
        }
        if (photoInput) photoInput.value = '';
        this.saveState();
      });
      this.personalInputsBound = true;
    }
  }

  populateHelperChips() {
    // Action Verbs Chips
    const verbContainer = document.getElementById('action-verbs-chips');
    if (verbContainer) {
      verbContainer.innerHTML = ACTION_VERBS.slice(0, 12).map(verb => `
        <button type="button" class="action-verb-chip px-2 py-0.5 rounded text-xs bg-slate-800 hover:bg-blue-600 hover:text-white text-slate-300 border border-slate-700 transition-colors" data-verb="${verb}">
          + ${verb}
        </button>
      `).join('');

      verbContainer.querySelectorAll('.action-verb-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          const verb = btn.getAttribute('data-verb');
          const summaryInput = document.getElementById('input-summary');
          if (summaryInput) {
            const start = summaryInput.selectionStart;
            const end = summaryInput.selectionEnd;
            const text = summaryInput.value;
            const insertion = verb + ' ';
            summaryInput.value = text.substring(0, start) + insertion + text.substring(end);
            this.state.personal.summary = summaryInput.value;
            this.saveState();
            summaryInput.focus();
            summaryInput.selectionStart = summaryInput.selectionEnd = start + insertion.length;
          }
        });
      });
    }

    // Summary Template Selector
    const summaryPresetSelect = document.getElementById('summary-preset-select');
    if (summaryPresetSelect) {
      summaryPresetSelect.innerHTML = `
        <option value="">⚡ Insert starter summary template...</option>
        ${SUMMARY_TEMPLATES.map((tmpl, idx) => `
          <option value="${idx}">${tmpl.role}</option>
        `).join('')}
      `;
      if (!this.summaryPresetBound) {
        summaryPresetSelect.addEventListener('change', (e) => {
          const val = e.target.value;
          if (val !== '') {
            const tmpl = SUMMARY_TEMPLATES[parseInt(val, 10)];
            if (tmpl) {
              const summaryInput = document.getElementById('input-summary');
              if (summaryInput) {
                summaryInput.value = tmpl.text;
                this.state.personal.summary = tmpl.text;
                this.saveState();
              }
            }
            e.target.value = '';
          }
        });
        this.summaryPresetBound = true;
      }
    }
  }

  // ----------------------------------------------------
  // Dynamic Experience Section
  // ----------------------------------------------------
  renderExperienceList() {
    const list = document.getElementById('experience-list');
    if (!list) return;

    list.innerHTML = (this.state.experiences || []).map((exp, idx) => `
      <div class="exp-item p-4 rounded-lg bg-slate-800/80 border border-slate-700/80 relative space-y-3" data-id="${escapeHtml(exp.id)}">
        <div class="flex items-center justify-between pb-2 border-b border-slate-700">
          <span class="text-xs font-bold text-blue-400 uppercase tracking-wider">#${idx + 1} • ${escapeHtml(exp.role || 'New Position')}</span>
          <button type="button" class="btn-delete-exp text-slate-400 hover:text-red-400 p-1 text-xs" data-id="${escapeHtml(exp.id)}" title="Delete experience">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="input-label">Role / Job Title</label>
            <input type="text" class="input-field exp-field" data-field="role" value="${escapeHtml(exp.role || '')}" placeholder="e.g. Lead Software Engineer">
          </div>
          <div>
            <label class="input-label">Company Name</label>
            <input type="text" class="input-field exp-field" data-field="company" value="${escapeHtml(exp.company || '')}" placeholder="e.g. Acme Tech">
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label class="input-label">Location</label>
            <input type="text" class="input-field exp-field" data-field="location" value="${escapeHtml(exp.location || '')}" placeholder="e.g. New York, NY">
          </div>
          <div>
            <label class="input-label">Start Date</label>
            <input type="text" class="input-field exp-field" data-field="startDate" value="${escapeHtml(exp.startDate || '')}" placeholder="e.g. 2021-04">
          </div>
          <div>
            <label class="input-label">End Date</label>
            <input type="text" class="input-field exp-field" data-field="endDate" value="${escapeHtml(exp.endDate || '')}" placeholder="e.g. Present" ${exp.current ? 'disabled' : ''}>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <input type="checkbox" id="curr-${escapeHtml(exp.id)}" class="exp-current-checkbox rounded text-blue-600 focus:ring-blue-500 bg-slate-900 border-slate-700" ${exp.current ? 'checked' : ''}>
          <label for="curr-${escapeHtml(exp.id)}" class="text-xs text-slate-300 font-medium cursor-pointer">I currently work here</label>
        </div>

        <div>
          <div class="flex justify-between items-center mb-1">
            <label class="input-label mb-0">Key Responsibilities & Achievements (1 per line)</label>
            <span class="text-2xs text-slate-400">💡 Start with action verbs & metrics</span>
          </div>
          <textarea rows="4" class="input-field exp-field font-mono text-xs leading-relaxed" data-field="description" placeholder="• Spearheaded automated deployment pipeline, saving 12 engineer-hours weekly...&#10;• Increased client retention by 18%...">${escapeHtml(exp.description || '')}</textarea>
        </div>
      </div>
    `).join('');

    // Attach listeners
    list.querySelectorAll('.exp-item').forEach(card => {
      const id = card.getAttribute('data-id');
      const item = this.state.experiences.find(e => e.id === id);
      if (!item) return;

      // Fields
      card.querySelectorAll('.exp-field').forEach(input => {
        input.addEventListener('input', (e) => {
          const field = input.getAttribute('data-field');
          item[field] = e.target.value;
          this.saveState();
        });
      });

      // Current checkbox
      card.querySelector('.exp-current-checkbox')?.addEventListener('change', (e) => {
        item.current = e.target.checked;
        if (item.current) {
          item.endDate = 'Present';
          const endInput = card.querySelector('[data-field="endDate"]');
          if (endInput) {
            endInput.value = 'Present';
            endInput.disabled = true;
          }
        } else {
          item.endDate = '';
          const endInput = card.querySelector('[data-field="endDate"]');
          if (endInput) {
            endInput.value = '';
            endInput.disabled = false;
          }
        }
        this.saveState();
      });

      // Delete button
      card.querySelector('.btn-delete-exp')?.addEventListener('click', () => {
        this.state.experiences = this.state.experiences.filter(e => e.id !== id);
        this.renderExperienceList();
        this.saveState();
      });
    });
  }

  // ----------------------------------------------------
  // Dynamic Education Section
  // ----------------------------------------------------
  renderEducationList() {
    const list = document.getElementById('education-list');
    if (!list) return;

    list.innerHTML = (this.state.education || []).map((edu, idx) => `
      <div class="edu-item p-4 rounded-lg bg-slate-800/80 border border-slate-700/80 space-y-3" data-id="${escapeHtml(edu.id)}">
        <div class="flex items-center justify-between pb-2 border-b border-slate-700">
          <span class="text-xs font-bold text-emerald-400 uppercase tracking-wider">#${idx + 1} • ${escapeHtml(edu.degree || 'Degree / Diploma')}</span>
          <button type="button" class="btn-delete-edu text-slate-400 hover:text-red-400 p-1 text-xs" data-id="${escapeHtml(edu.id)}" title="Delete education">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="input-label">Degree & Major</label>
            <input type="text" class="input-field edu-field" data-field="degree" value="${escapeHtml(edu.degree || '')}" placeholder="e.g. B.S. in Computer Science">
          </div>
          <div>
            <label class="input-label">School / University</label>
            <input type="text" class="input-field edu-field" data-field="school" value="${escapeHtml(edu.school || '')}" placeholder="e.g. Stanford University">
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label class="input-label">Location</label>
            <input type="text" class="input-field edu-field" data-field="location" value="${escapeHtml(edu.location || '')}" placeholder="e.g. Stanford, CA">
          </div>
          <div>
            <label class="input-label">Start Date</label>
            <input type="text" class="input-field edu-field" data-field="startDate" value="${escapeHtml(edu.startDate || '')}" placeholder="e.g. 2016-09">
          </div>
          <div>
            <label class="input-label">End / Graduation Date</label>
            <input type="text" class="input-field edu-field" data-field="endDate" value="${escapeHtml(edu.endDate || '')}" placeholder="e.g. 2020-06">
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="input-label">Grade / GPA (Optional)</label>
            <input type="text" class="input-field edu-field" data-field="grade" value="${escapeHtml(edu.grade || '')}" placeholder="e.g. 3.9 GPA">
          </div>
          <div>
            <label class="input-label">Honors & Activities (Optional)</label>
            <input type="text" class="input-field edu-field" data-field="honors" value="${escapeHtml(edu.honors || '')}" placeholder="e.g. Magna Cum Laude">
          </div>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.edu-item').forEach(card => {
      const id = card.getAttribute('data-id');
      const item = this.state.education.find(e => e.id === id);
      if (!item) return;

      card.querySelectorAll('.edu-field').forEach(input => {
        input.addEventListener('input', (e) => {
          const field = input.getAttribute('data-field');
          item[field] = e.target.value;
          this.saveState();
        });
      });

      card.querySelector('.btn-delete-edu')?.addEventListener('click', () => {
        this.state.education = this.state.education.filter(e => e.id !== id);
        this.renderEducationList();
        this.saveState();
      });
    });
  }

  // ----------------------------------------------------
  // Dynamic Skills Section
  // ----------------------------------------------------
  renderSkillsList() {
    const list = document.getElementById('skills-list');
    if (!list) return;

    list.innerHTML = (this.state.skills || []).map((group, idx) => `
      <div class="skill-group-card p-4 rounded-lg bg-slate-800/80 border border-slate-700/80 space-y-3" data-idx="${idx}">
        <div class="flex items-center justify-between pb-2 border-b border-slate-700">
          <div class="flex-1 mr-4">
            <input type="text" class="input-field font-bold text-white skill-category-input" value="${escapeHtml(group.category || '')}" placeholder="Category (e.g. Frontend, Tools, Management)">
          </div>
          <button type="button" class="btn-delete-skill-group text-slate-400 hover:text-red-400 p-1 text-xs" data-idx="${idx}" title="Delete category">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>

        <div>
          <label class="input-label">Skills in this category (press Enter or Comma to add)</label>
          <div class="flex flex-wrap gap-1.5 p-2 rounded-lg bg-slate-900 border border-slate-700 min-h-[44px] items-center skill-tags-container" data-idx="${idx}">
            ${(group.items || []).map((skill, sIdx) => `
              <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-blue-600/30 text-blue-200 border border-blue-500/40">
                ${escapeHtml(skill)}
                <button type="button" class="btn-remove-tag text-blue-300 hover:text-white" data-group-idx="${idx}" data-skill-idx="${sIdx}">&times;</button>
              </span>
            `).join('')}
            <input type="text" class="skill-tag-input bg-transparent border-none text-xs text-white outline-none flex-1 min-w-[120px] p-1" placeholder="Type skill & press Enter...">
          </div>
        </div>
      </div>
    `).join('');

    // Attach listeners
    list.querySelectorAll('.skill-group-card').forEach(card => {
      const idx = parseInt(card.getAttribute('data-idx'), 10);
      const group = this.state.skills[idx];
      if (!group) return;

      // Category input
      card.querySelector('.skill-category-input')?.addEventListener('input', (e) => {
        group.category = e.target.value;
        this.saveState();
      });

      // Delete group
      card.querySelector('.btn-delete-skill-group')?.addEventListener('click', () => {
        this.state.skills.splice(idx, 1);
        this.renderSkillsList();
        this.saveState();
      });

      // Tag input (Enter or comma)
      const tagInput = card.querySelector('.skill-tag-input');
      tagInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          const val = tagInput.value.replace(/,/g, '').trim();
          if (val) {
            if (!group.items) group.items = [];
            group.items.push(val);
            tagInput.value = '';
            this.renderSkillsList();
            this.saveState();
          }
        }
      });

      // Remove single tag button
      card.querySelectorAll('.btn-remove-tag').forEach(rmBtn => {
        rmBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const sIdx = parseInt(rmBtn.getAttribute('data-skill-idx'), 10);
          group.items.splice(sIdx, 1);
          this.renderSkillsList();
          this.saveState();
        });
      });
    });
  }

  // ----------------------------------------------------
  // Dynamic Projects Section
  // ----------------------------------------------------
  renderProjectsList() {
    const list = document.getElementById('projects-list');
    if (!list) return;

    list.innerHTML = (this.state.projects || []).map((proj, idx) => `
      <div class="proj-item p-4 rounded-lg bg-slate-800/80 border border-slate-700/80 space-y-3" data-id="${escapeHtml(proj.id)}">
        <div class="flex items-center justify-between pb-2 border-b border-slate-700">
          <span class="text-xs font-bold text-purple-400 uppercase tracking-wider">#${idx + 1} • ${escapeHtml(proj.title || 'Project Name')}</span>
          <button type="button" class="btn-delete-proj text-slate-400 hover:text-red-400 p-1 text-xs" data-id="${escapeHtml(proj.id)}" title="Delete project">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="input-label">Project Title</label>
            <input type="text" class="input-field proj-field" data-field="title" value="${escapeHtml(proj.title || '')}" placeholder="e.g. DevPulse Cloud">
          </div>
          <div>
            <label class="input-label">Technologies Used</label>
            <input type="text" class="input-field proj-field" data-field="tech" value="${escapeHtml(proj.tech || '')}" placeholder="e.g. React, Node.js, AWS">
          </div>
        </div>

        <div>
          <label class="input-label">Project URL / GitHub Link</label>
          <input type="text" class="input-field proj-field" data-field="link" value="${escapeHtml(proj.link || '')}" placeholder="e.g. https://github.com/username/project">
        </div>

        <div>
          <label class="input-label">Description & Impact</label>
          <textarea rows="2" class="input-field proj-field text-xs" data-field="description" placeholder="Short description of what you engineered and results...">${escapeHtml(proj.description || '')}</textarea>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.proj-item').forEach(card => {
      const id = card.getAttribute('data-id');
      const item = this.state.projects.find(p => p.id === id);
      if (!item) return;

      card.querySelectorAll('.proj-field').forEach(input => {
        input.addEventListener('input', (e) => {
          const field = input.getAttribute('data-field');
          item[field] = e.target.value;
          this.saveState();
        });
      });

      card.querySelector('.btn-delete-proj')?.addEventListener('click', () => {
        this.state.projects = this.state.projects.filter(p => p.id !== id);
        this.renderProjectsList();
        this.saveState();
      });
    });
  }

  // ----------------------------------------------------
  // Dynamic Certifications & Languages
  // ----------------------------------------------------
  renderCertificationsList() {
    const list = document.getElementById('certifications-list');
    if (!list) return;

    list.innerHTML = (this.state.certifications || []).map((cert, idx) => `
      <div class="cert-item p-3 rounded-lg bg-slate-800/80 border border-slate-700/80 space-y-2" data-id="${escapeHtml(cert.id)}">
        <div class="flex items-center justify-between">
          <input type="text" class="input-field font-semibold text-xs cert-field flex-1 mr-2" data-field="name" value="${escapeHtml(cert.name || '')}" placeholder="Certification Name">
          <button type="button" class="btn-delete-cert text-slate-400 hover:text-red-400 p-1" data-id="${escapeHtml(cert.id)}">&times;</button>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <input type="text" class="input-field text-xs cert-field" data-field="issuer" value="${escapeHtml(cert.issuer || '')}" placeholder="Issuer (e.g. AWS)">
          <input type="text" class="input-field text-xs cert-field" data-field="date" value="${escapeHtml(cert.date || '')}" placeholder="Year / Date (e.g. 2023)">
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.cert-item').forEach(card => {
      const id = card.getAttribute('data-id');
      const item = this.state.certifications.find(c => c.id === id);
      if (!item) return;

      card.querySelectorAll('.cert-field').forEach(input => {
        input.addEventListener('input', (e) => {
          item[input.getAttribute('data-field')] = e.target.value;
          this.saveState();
        });
      });

      card.querySelector('.btn-delete-cert')?.addEventListener('click', () => {
        this.state.certifications = this.state.certifications.filter(c => c.id !== id);
        this.renderCertificationsList();
        this.saveState();
      });
    });
  }

  renderLanguagesList() {
    const list = document.getElementById('languages-list');
    if (!list) return;

    list.innerHTML = (this.state.languages || []).map((lang, idx) => `
      <div class="lang-item flex items-center gap-2" data-idx="${idx}">
        <input type="text" class="input-field text-xs lang-field" data-field="language" value="${escapeHtml(lang.language || '')}" placeholder="Language (e.g. French)">
        <input type="text" class="input-field text-xs lang-field" data-field="fluency" value="${escapeHtml(lang.fluency || '')}" placeholder="Fluency (e.g. Fluent, Native)">
        <button type="button" class="btn-delete-lang text-slate-400 hover:text-red-400 px-2 py-1 text-sm" data-idx="${idx}">&times;</button>
      </div>
    `).join('');

    list.querySelectorAll('.lang-item').forEach(card => {
      const idx = parseInt(card.getAttribute('data-idx'), 10);
      const item = this.state.languages[idx];
      if (!item) return;

      card.querySelectorAll('.lang-field').forEach(input => {
        input.addEventListener('input', (e) => {
          item[input.getAttribute('data-field')] = e.target.value;
          this.saveState();
        });
      });

      card.querySelector('.btn-delete-lang')?.addEventListener('click', () => {
        this.state.languages.splice(idx, 1);
        this.renderLanguagesList();
        this.saveState();
      });
    });
  }

  // ----------------------------------------------------
  // Dynamic Custom Sections
  // ----------------------------------------------------
  renderCustomSectionsList() {
    const list = document.getElementById('custom-sections-list');
    if (!list) return;

    list.innerHTML = (this.state.customSections || []).map((sec, sIdx) => `
      <div class="custom-sec-item p-4 rounded-lg bg-slate-800/80 border border-slate-700/80 space-y-3" data-id="${escapeHtml(sec.id)}">
        <div class="flex items-center justify-between pb-2 border-b border-slate-700">
          <input type="text" class="input-field font-bold text-amber-400 sec-title-input flex-1 mr-3" value="${escapeHtml(sec.title || '')}" placeholder="Section Title (e.g. Publications, Volunteer, Awards)">
          <button type="button" class="btn-delete-custom-sec text-slate-400 hover:text-red-400 p-1 text-xs" data-id="${escapeHtml(sec.id)}">&times;</button>
        </div>
        <div class="space-y-2 sec-items-container">
          ${(sec.items || []).map((it, iIdx) => `
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input type="text" class="input-field text-xs sec-item-field sm:col-span-2" data-item-idx="${iIdx}" data-field="title" value="${escapeHtml(it.title || '')}" placeholder="Title / Recognition">
              <input type="text" class="input-field text-xs sec-item-field" data-item-idx="${iIdx}" data-field="date" value="${escapeHtml(it.date || '')}" placeholder="Year / Subtitle">
            </div>
          `).join('')}
        </div>
        <button type="button" class="btn-add-sec-item text-xs text-blue-400 hover:text-blue-300 font-semibold" data-id="${escapeHtml(sec.id)}">+ Add Item</button>
      </div>
    `).join('');

    list.querySelectorAll('.custom-sec-item').forEach(card => {
      const id = card.getAttribute('data-id');
      const sec = this.state.customSections.find(s => s.id === id);
      if (!sec) return;

      card.querySelector('.sec-title-input')?.addEventListener('input', (e) => {
        sec.title = e.target.value;
        this.saveState();
      });

      card.querySelector('.btn-delete-custom-sec')?.addEventListener('click', () => {
        this.state.customSections = this.state.customSections.filter(s => s.id !== id);
        this.renderCustomSectionsList();
        this.saveState();
      });

      card.querySelectorAll('.sec-item-field').forEach(input => {
        input.addEventListener('input', (e) => {
          const iIdx = parseInt(input.getAttribute('data-item-idx'), 10);
          const fld = input.getAttribute('data-field');
          if (sec.items[iIdx]) {
            sec.items[iIdx][fld] = e.target.value;
            this.saveState();
          }
        });
      });

      card.querySelector('.btn-add-sec-item')?.addEventListener('click', () => {
        if (!sec.items) sec.items = [];
        sec.items.push({ title: '', subtitle: '', date: '' });
        this.renderCustomSectionsList();
        this.saveState();
      });
    });
  }

  // ----------------------------------------------------
  // Event Delegation for "Add New" Buttons & Presets
  // ----------------------------------------------------
  setupEventDelegation() {
    // Add Experience Button
    document.getElementById('btn-add-experience')?.addEventListener('click', () => {
      if (!this.state.experiences) this.state.experiences = [];
      const newId = 'exp-' + Date.now();
      this.state.experiences.unshift({
        id: newId,
        role: '',
        company: '',
        location: '',
        startDate: '',
        endDate: '',
        current: false,
        description: '• '
      });
      this.renderExperienceList();
      this.saveState();
    });

    // Add Education Button
    document.getElementById('btn-add-education')?.addEventListener('click', () => {
      if (!this.state.education) this.state.education = [];
      const newId = 'edu-' + Date.now();
      this.state.education.unshift({
        id: newId,
        degree: '',
        school: '',
        location: '',
        startDate: '',
        endDate: '',
        grade: '',
        honors: ''
      });
      this.renderEducationList();
      this.saveState();
    });

    // Add Skill Category Button
    document.getElementById('btn-add-skill-group')?.addEventListener('click', () => {
      if (!this.state.skills) this.state.skills = [];
      this.state.skills.push({
        category: 'New Category',
        items: []
      });
      this.renderSkillsList();
      this.saveState();
    });

    // Add Project Button
    document.getElementById('btn-add-project')?.addEventListener('click', () => {
      if (!this.state.projects) this.state.projects = [];
      const newId = 'proj-' + Date.now();
      this.state.projects.unshift({
        id: newId,
        title: '',
        tech: '',
        link: '',
        description: ''
      });
      this.renderProjectsList();
      this.saveState();
    });

    // Add Certification Button
    document.getElementById('btn-add-cert')?.addEventListener('click', () => {
      if (!this.state.certifications) this.state.certifications = [];
      this.state.certifications.push({
        id: 'cert-' + Date.now(),
        name: '',
        issuer: '',
        date: '',
        link: ''
      });
      this.renderCertificationsList();
      this.saveState();
    });

    // Add Language Button
    document.getElementById('btn-add-lang')?.addEventListener('click', () => {
      if (!this.state.languages) this.state.languages = [];
      this.state.languages.push({ language: '', fluency: '' });
      this.renderLanguagesList();
      this.saveState();
    });

    // Add Custom Section Button
    document.getElementById('btn-add-custom-sec')?.addEventListener('click', () => {
      if (!this.state.customSections) this.state.customSections = [];
      this.state.customSections.push({
        id: 'custom-' + Date.now(),
        title: 'Volunteer Experience',
        items: [{ title: '', subtitle: '', date: '' }]
      });
      this.renderCustomSectionsList();
      this.saveState();
    });

    // Preset Loader
    document.querySelectorAll('.preset-select-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const presetKey = btn.getAttribute('data-preset');
        if (presetKey === 'blank') {
          if (confirm('Start with a blank resume? This will clear current fields.')) {
            this.state = {
              theme: { ...INITIAL_DATA.theme },
              personal: { fullName: '', jobTitle: '', email: '', phone: '', location: '', website: '', linkedin: '', github: '', photo: '', summary: '' },
              experiences: [],
              education: [],
              skills: [{ category: 'Core Skills', items: [] }],
              projects: [],
              certifications: [],
              languages: [],
              customSections: [],
              targetJobDescription: ''
            };
            this.resetHistory();
            this.populateEditorForms();
            this.setupThemeControls();
            this.saveState();
            this.showToast('Blank resume created', 'success');
          }
        } else if (SAMPLE_PRESETS[presetKey]) {
          if (confirm(`Load the ${btn.textContent.trim()} template? Your current unsaved changes will be replaced.`)) {
            this.state = this.normalizeState(SAMPLE_PRESETS[presetKey]);
            this.resetHistory();
            this.populateEditorForms();
            this.setupThemeControls();
            this.saveState();
            this.showToast('Preset loaded', 'success');
          }
        }
      });
    });
  }

  // ----------------------------------------------------
  // ATS Score Tracker & Optimizer Modal
  // ----------------------------------------------------
  updateAtsScore() {
    const ats = calculateAtsScore(this.state);
    
    // Update navbar mini meter
    const navScore = document.getElementById('ats-nav-score');
    const navPill = document.getElementById('btn-open-ats');
    if (navScore) navScore.textContent = `${ats.score}/100`;
    if (navPill) {
      navPill.style.borderColor = ats.badgeColor;
    }

    const progressScore = document.getElementById('resume-progress-score');
    const progressBar = document.getElementById('resume-progress-bar');
    const progressLabel = document.getElementById('resume-progress-label');
    if (progressScore) progressScore.textContent = `${ats.score}%`;
    if (progressBar) progressBar.style.width = `${ats.score}%`;
    if (progressLabel) {
      if (ats.score >= 90) progressLabel.textContent = 'Ready to apply';
      else if (ats.score >= 75) progressLabel.textContent = 'Strong — a few improvements left';
      else progressLabel.textContent = 'Add details to strengthen your resume';
    }

    // Modal contents
    const modalScore = document.getElementById('ats-modal-score');
    const modalRating = document.getElementById('ats-modal-rating');
    const modalChecks = document.getElementById('ats-modal-checks');
    const modalSuggestions = document.getElementById('ats-modal-suggestions');

    if (modalScore) modalScore.textContent = ats.score;
    if (modalRating) {
      modalRating.textContent = ats.rating;
      modalRating.style.color = ats.badgeColor;
    }

    if (modalChecks) {
      modalChecks.innerHTML = ats.checks.map(c => `
        <div class="flex items-center justify-between text-xs py-1.5 border-b border-slate-700/60">
          <span class="text-slate-300">${c.name}</span>
          <span class="font-bold font-mono ${c.score >= c.max * 0.7 ? 'text-green-400' : 'text-amber-400'}">${c.score} / ${c.max}</span>
        </div>
      `).join('');
    }

    if (modalSuggestions) {
      if (ats.suggestions.length === 0) {
        modalSuggestions.innerHTML = `
          <div class="p-3 bg-green-900/30 border border-green-700/50 rounded-lg text-xs text-green-300 flex items-center gap-2">
            <span>🎉 Outstanding job! Your resume is highly optimized for modern ATS parsers and human recruiters.</span>
          </div>
        `;
      } else {
        modalSuggestions.innerHTML = ats.suggestions.map(s => `
          <div class="flex items-start gap-2 p-2.5 rounded-md text-xs ${
            s.type === 'danger' ? 'bg-red-950/40 border border-red-800/60 text-red-300' :
            s.type === 'warning' ? 'bg-amber-950/40 border border-amber-800/60 text-amber-300' :
            'bg-blue-950/40 border border-blue-800/60 text-blue-300'
          }">
            <span class="font-bold flex-shrink-0">${s.type === 'danger' ? '❌' : s.type === 'warning' ? '⚠️' : '💡'}</span>
            <span class="leading-relaxed">${escapeHtml(s.text)}</span>
          </div>
        `).join('');
      }
    }
    this.updateJobMatch();
  }

  setupAtsModal() {
    const modal = document.getElementById('ats-modal');
    const openBtn = document.getElementById('btn-open-ats');
    const closeBtn = document.getElementById('btn-close-ats');
    const footerCloseBtn = document.getElementById('btn-close-ats-footer');

    openBtn?.addEventListener('click', () => {
      this.updateAtsScore();
      modal?.classList.remove('hidden');
    });

    closeBtn?.addEventListener('click', () => {
      modal?.classList.add('hidden');
    });

    footerCloseBtn?.addEventListener('click', () => {
      modal?.classList.add('hidden');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
        modal.classList.add('hidden');
        openBtn?.focus();
      }
    });

    modal?.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.add('hidden');
      }
    });
  }

  // ----------------------------------------------------
  // Export & Import Tools (PDF, JSON, Print)
  // ----------------------------------------------------
  setupExportImport() {
    // Print Dialog (Ctrl+P / Print Button)
    document.getElementById('btn-print-resume')?.addEventListener('click', () => {
      window.print();
    });

    // PDF Download via html2pdf
    document.getElementById('btn-download-pdf')?.addEventListener('click', () => {
      const element = document.getElementById('resume-container');
      const filename = `${(this.state.personal.fullName || 'resume').toLowerCase().replace(/\s+/g, '_')}_resume.pdf`;

      const opt = {
        margin: 0,
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, letterRendering: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };

      if (window.html2pdf) {
        const btn = document.getElementById('btn-download-pdf');
        const originalText = btn.innerHTML;
        btn.innerHTML = `<span class="animate-spin inline-block mr-1">⏳</span> Generating PDF...`;
        btn.disabled = true;

        window.html2pdf().set(opt).from(element).save().then(() => {
          btn.innerHTML = originalText;
          btn.disabled = false;
          this.showToast('PDF exported successfully', 'success');
        }).catch(err => {
          console.error('html2pdf error:', err);
          btn.innerHTML = originalText;
          btn.disabled = false;
          // Fallback to browser print
          window.print();
        });
      } else {
        window.print();
      }
    });

    // JSON Export
    document.getElementById('btn-export-json')?.addEventListener('click', () => {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(this.state, null, 2));
      const downloadAnchor = document.createElement('a');
      const filename = `${(this.state.personal.fullName || 'resume').toLowerCase().replace(/\s+/g, '_')}_data.json`;
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute('download', filename);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      this.showToast('Resume backup downloaded', 'success');
    });

    // JSON Import
    const importFileInput = document.getElementById('import-json-input');
    document.getElementById('btn-trigger-import')?.addEventListener('click', () => {
      importFileInput?.click();
    });

    importFileInput?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        if (file.size > 5 * 1024 * 1024) {
          alert('Resume JSON files must be smaller than 5 MB.');
          e.target.value = '';
          return;
        }
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const parsed = JSON.parse(event.target.result);
            if (parsed.personal && typeof parsed.personal === 'object' && parsed.theme && typeof parsed.theme === 'object') {
              this.state = this.normalizeState(parsed);
              this.resetHistory();
              this.populateEditorForms();
              this.setupThemeControls();
              this.saveState();
                this.showToast('Resume data imported successfully', 'success');
            } else {
              alert('Invalid resume JSON format.');
            }
          } catch (err) {
            alert('Error parsing JSON file: ' + err.message);
          }
        };
        reader.readAsText(file);
      }
    });

    // Reset All Data Button
    document.getElementById('btn-reset-data')?.addEventListener('click', () => {
      if (confirm('Reset to initial default demo resume?')) {
        this.state = this.normalizeState(INITIAL_DATA);
        this.resetHistory();
        this.populateEditorForms();
        this.setupThemeControls();
        this.saveState();
        this.showToast('Demo resume restored', 'success');
      }
    });
  }
}

// Initialize on DOM Ready
window.addEventListener('DOMContentLoaded', () => {
  window.app = new ResumeCraftApp();
});
