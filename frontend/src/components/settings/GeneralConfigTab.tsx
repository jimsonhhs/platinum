import { useState, useEffect } from 'react'
import { Folder, RefreshCw, GitFork, Languages, Download, Loader2, CheckCircle2, AlertCircle, Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SaveGitConfig, GetVersion, CheckUpdate } from '@/lib/wailsjs/go/app/App'
import type { update as updateModels } from '@/lib/wailsjs/go/models'
import { useApp, type novel } from '@/hooks/useApp'
import UpdateDialog from '@/components/update/UpdateDialog'

export default function GeneralConfigTab() {
  const app = useApp()
  const { t, i18n } = useTranslation()
  const [dataDirInput, setDataDirInput] = useState('')
  const [dataDirSaving, setDataDirSaving] = useState(false)
  const [dataDirSaved, setDataDirSaved] = useState(false)
  const [novels, setNovels] = useState<novel.Novel[]>([])
  const [selectedID, setSelectedID] = useState<number>(0)
  const [rebuilding, setRebuilding] = useState(false)
  const [gitName, setGitName] = useState('')
  const [gitEmail, setGitEmail] = useState('')
  const [gitSaving, setGitSaving] = useState(false)
  const [gitSaved, setGitSaved] = useState(false)
  const [gitError, setGitError] = useState<string | null>(null)
  const [appVersion, setAppVersion] = useState('')
  const [checking, setChecking] = useState(false)
  const [updateResult, setUpdateResult] = useState<updateModels.CheckResult | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [showUpdateDialog, setShowUpdateDialog] = useState(false)
  const [reminderMinutes, setReminderMinutes] = useState(10)
  const [reminderSaving, setReminderSaving] = useState(false)
  const [reminderSaved, setReminderSaved] = useState(false)
  const [archiveMinutes, setArchiveMinutes] = useState(30)
  const [archiveSaving, setArchiveSaving] = useState(false)
  const [archiveSaved, setArchiveSaved] = useState(false)
  const [historyLimit, setHistoryLimit] = useState(50)
  const [historyLimitSaving, setHistoryLimitSaving] = useState(false)
  const [historyLimitSaved, setHistoryLimitSaved] = useState(false)

  useEffect(() => {
    app.GetAppConfig().then(cfg => {
      setDataDirInput((cfg?.data_dir as string) || '')
    }).catch(() => {})
    app.GetNovels().then(list => {
      setNovels(list || [])
    }).catch(() => {})
    app.GetSettings().then(s => {
      if (s?.last_novel_id) setSelectedID(s.last_novel_id)
      if (s?.git_name) setGitName(s.git_name)
      if (s?.git_email) setGitEmail(s.git_email)
      if (typeof s?.maintain_reminder_minutes === 'number') setReminderMinutes(s.maintain_reminder_minutes)
      if (typeof s?.archive_interval_minutes === 'number') setArchiveMinutes(s.archive_interval_minutes)
      if (typeof s?.history_limit === 'number' && s.history_limit > 0) setHistoryLimit(s.history_limit)
    }).catch(() => {})
    GetVersion().then(v => setAppVersion(v || 'dev')).catch(() => {})
  }, [app])

  async function handleSaveGit() {
    setGitSaving(true)
    setGitSaved(false)
    setGitError(null)
    try {
      await SaveGitConfig(gitName, gitEmail)
      setGitSaved(true)
      setTimeout(() => setGitSaved(false), 2000)
    } catch (err) {
      setGitError(err instanceof Error ? err.message : t('settings.saveFailed'))
    } finally {
      setGitSaving(false)
    }
  }

  async function handleRebuild() {
    if (!selectedID) return
    setRebuilding(true)
    try {
      await app.RebuildNovelIndex(selectedID)
    } catch (err) {
      console.error('Rebuild failed:', err)
    } finally {
      setRebuilding(false)
    }
  }

  async function handleCheckUpdate() {
    setChecking(true)
    setUpdateResult(null)
    setUpdateError(null)
    try {
      const result = await CheckUpdate(true)
      setUpdateResult(result)
      if (result?.hasUpdate) {
        setShowUpdateDialog(true)
      }
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : t('update.checkFailed'))
    } finally {
      setChecking(false)
    }
  }

  async function handleSaveDataDir() {
    setDataDirSaving(true)
    setDataDirSaved(false)
    try {
      await app.SetDataDir(dataDirInput.trim())
      setDataDirSaved(true)
      setTimeout(() => setDataDirSaved(false), 3000)
    } catch (err) {
      console.error('save data dir failed:', err)
    } finally {
      setDataDirSaving(false)
    }
  }

  async function handleSaveReminder() {
    setReminderSaving(true)
    setReminderSaved(false)
    try {
      await app.SaveMaintainReminderMinutes(reminderMinutes)
      setReminderSaved(true)
      setTimeout(() => setReminderSaved(false), 2000)
    } catch (err) {
      console.error('save reminder failed:', err)
    } finally {
      setReminderSaving(false)
    }
  }

  async function handleSaveArchive() {
    setArchiveSaving(true)
    setArchiveSaved(false)
    try {
      await app.SaveArchiveInterval(archiveMinutes)
      setArchiveSaved(true)
      setTimeout(() => setArchiveSaved(false), 2000)
    } catch (err) {
      console.error('save archive interval failed:', err)
    } finally {
      setArchiveSaving(false)
    }
  }

  async function handleSaveHistoryLimit() {
    setHistoryLimitSaving(true)
    setHistoryLimitSaved(false)
    try {
      await app.SaveHistoryLimit(historyLimit)
      setHistoryLimitSaved(true)
      setTimeout(() => setHistoryLimitSaved(false), 2000)
    } catch (err) {
      console.error('save history limit failed:', err)
    } finally {
      setHistoryLimitSaving(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col">
      <h3 className="text-sm font-medium mb-5">{t('settings.basicConfig')}</h3>

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Folder className="w-3.5 h-3.5" />
          {t('settings.dataDir')}
        </label>
        <div className="flex items-center gap-2">
          <input
            value={dataDirInput}
            onChange={e => setDataDirInput(e.target.value)}
            placeholder="C:/path/to/platinum"
            className="flex-1 h-8 rounded-md border bg-background px-3 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={handleSaveDataDir}
            disabled={dataDirSaving || !dataDirInput.trim()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs border hover:bg-muted transition-colors disabled:opacity-50 shrink-0"
          >
            {dataDirSaving ? t('common.saving') : dataDirSaved ? t('common.saved') : t('settings.saveDataDir')}
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">{t('settings.dataDirHint')}</p>
      </div>

      <div className="mt-6 space-y-3">
        <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <GitFork className="w-3.5 h-3.5" />
          {t('settings.gitConfig')}
        </label>
        <p className="text-[11px] text-muted-foreground">{t('settings.gitConfigDesc')}</p>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-12 shrink-0">{t('settings.nickname')}</span>
            <input
              value={gitName}
              onChange={e => setGitName(e.target.value)}
              placeholder="Platinum"
              className="flex-1 h-8 rounded-md border bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-12 shrink-0">{t('settings.email')}</span>
            <input
              value={gitEmail}
              onChange={e => setGitEmail(e.target.value)}
              placeholder="platinum@local"
              className="flex-1 h-8 rounded-md border bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-2">
              {gitError && <span className="text-[11px] text-rose-500">{gitError}</span>}
            </div>
            <button
              onClick={handleSaveGit}
              disabled={gitSaving}
              className="inline-flex items-center gap-1.5 h-8 px-4 rounded-md text-xs border hover:bg-muted transition-colors disabled:opacity-50"
            >
              {gitSaving ? t('common.saving') : gitSaved ? t('common.saved') : t('common.save')}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-6 space-y-2">
        <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Languages className="w-3.5 h-3.5" />
          {t('settings.language')}
        </label>
        <div className="inline-flex items-center gap-1 rounded-lg bg-muted/60 p-0.5">
          <button
            onClick={() => i18n.changeLanguage('zh-CN')}
            className={`h-7 px-3 rounded-md text-xs transition-colors ${
              i18n.language.startsWith('zh') ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            中文
          </button>
          <button
            onClick={() => i18n.changeLanguage('en')}
            className={`h-7 px-3 rounded-md text-xs transition-colors ${
              i18n.language === 'en' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            English
          </button>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" />
          {t('settings.maintainReminder')}
        </label>
        <p className="text-[11px] text-muted-foreground">{t('settings.maintainReminderDesc')}</p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={240}
            value={reminderMinutes}
            onChange={e => setReminderMinutes(Number(e.target.value))}
            className="w-24 h-8 rounded-md border bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="text-xs text-muted-foreground">{t('settings.maintainReminderUnit')}</span>
          <button
            onClick={handleSaveReminder}
            disabled={reminderSaving}
            className="inline-flex items-center gap-1.5 h-8 px-4 rounded-md text-xs border hover:bg-muted transition-colors disabled:opacity-50"
          >
            {reminderSaving ? t('common.saving') : reminderSaved ? t('common.saved') : t('common.save')}
          </button>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Download className="w-3.5 h-3.5" />
          {t('settings.archiveInterval')}
        </label>
        <p className="text-[11px] text-muted-foreground">{t('settings.archiveIntervalDesc')}</p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={1440}
            value={archiveMinutes}
            onChange={e => setArchiveMinutes(Number(e.target.value))}
            className="w-24 h-8 rounded-md border bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="text-xs text-muted-foreground">{t('settings.archiveIntervalUnit')}</span>
          <button
            onClick={handleSaveArchive}
            disabled={archiveSaving}
            className="inline-flex items-center gap-1.5 h-8 px-4 rounded-md text-xs border hover:bg-muted transition-colors disabled:opacity-50"
          >
            {archiveSaving ? t('common.saving') : archiveSaved ? t('common.saved') : t('common.save')}
          </button>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          {t('settings.historyLimit')}
        </label>
        <p className="text-[11px] text-muted-foreground">{t('settings.historyLimitDesc')}</p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={200}
            value={historyLimit}
            onChange={e => setHistoryLimit(Number(e.target.value))}
            className="w-24 h-8 rounded-md border bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="text-xs text-muted-foreground">{t('settings.historyLimitUnit')}</span>
          <button
            onClick={handleSaveHistoryLimit}
            disabled={historyLimitSaving}
            className="inline-flex items-center gap-1.5 h-8 px-4 rounded-md text-xs border hover:bg-muted transition-colors disabled:opacity-50"
          >
            {historyLimitSaving ? t('common.saving') : historyLimitSaved ? t('common.saved') : t('common.save')}
          </button>
        </div>
      </div>

      <div className="mt-6 space-y-2">
        <label className="text-xs font-medium text-muted-foreground">{t('settings.maintenance')}</label>
        <p className="text-[11px] text-muted-foreground">{t('settings.rebuildIndexDesc')}</p>
        <div className="flex items-center gap-2">
          <select
            value={selectedID}
            onChange={e => setSelectedID(Number(e.target.value))}
            className="h-8 rounded-md border bg-background px-2 text-xs focus:outline-none"
          >
            {novels.map(n => (
              <option key={n.id} value={n.id}>{n.title}</option>
            ))}
          </select>
          <button
            onClick={handleRebuild}
            disabled={rebuilding || !selectedID}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs border hover:bg-muted transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${rebuilding ? 'animate-spin' : ''}`} />
            {rebuilding ? t('settings.rebuilding') : t('settings.rebuildIndex')}
          </button>
        </div>
      </div>

      <div className="mt-6 space-y-2">
        <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Download className="w-3.5 h-3.5" />
          {t('update.versionAndUpdate')}
        </label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('update.currentVersion')}</span>
          <span className="text-xs font-mono text-foreground">
            v{appVersion}
          </span>
          <button
            onClick={handleCheckUpdate}
            disabled={checking}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs border hover:bg-muted transition-colors disabled:opacity-50"
          >
            {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {checking ? t('update.checking') : t('update.checkNow')}
          </button>
          {updateResult?.hasUpdate && (
            <span className="inline-flex items-center gap-1 text-xs text-primary">
              <Download className="w-3 h-3" />
              {t('update.versionLabel', { version: updateResult.latest.tag_name })}
            </span>
          )}
          {updateResult && !updateResult.hasUpdate && (
            <span className="inline-flex items-center gap-1 text-xs text-tag-green-foreground">
              <CheckCircle2 className="w-3 h-3" />
              {t('update.upToDate')}
            </span>
          )}
          {updateError && (
            <span className="inline-flex items-center gap-1 text-xs text-rose-500">
              <AlertCircle className="w-3 h-3" />
              {updateError}
            </span>
          )}
        </div>
      </div>

      <UpdateDialog
        open={showUpdateDialog}
        result={updateResult}
        onClose={() => setShowUpdateDialog(false)}
      />
    </div>
  )
}
