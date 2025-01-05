'use client'

import { useState, useEffect, useRef } from 'react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Menu, Hexagon, LogIn, LogOut, Plus, Users, History as HistoryIcon, ArrowRight, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Label } from "@/components/ui/label"

interface HistoryItem {
  id: string;
  title: string;
  thread: any[];
  timestamp: string;
}

interface SidebarProps {
  className?: string;
  onHistoryItemClick?: (thread: any[]) => void;
}

const ControlledInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentPropsWithoutRef<'input'> & { onValueChange: (value: string) => void }
>(({ onValueChange, ...props }, ref) => {
  const inputRef = useRef<HTMLInputElement>(null)
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation()
    onValueChange(e.target.value)
  }

  return (
    <Input
      {...props}
      ref={inputRef}
      onChange={handleChange}
      className={cn("bg-[#1C1C1C] border-0 focus:ring-1 focus:ring-white/20", props.className)}
    />
  )
})
ControlledInput.displayName = 'ControlledInput'

const LoginForm = ({
  onLogin,
  onRegister,
  error,
}: {
  onLogin: (username: string, password: string) => void
  onRegister: (username: string, password: string) => void
  error?: string | null
}) => {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isRegistering, setIsRegistering] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (isRegistering) {
      onRegister(username, password)
    } else {
      onLogin(username, password)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex flex-col items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-white/5">
          <Hexagon className="h-5 w-5" />
        </div>

        <div className="text-center text-sm text-white/60">
          {isRegistering ? "Already have an account? " : "Don't have an account? "}
          <button
            onClick={() => setIsRegistering(!isRegistering)}
            className="text-white hover:underline underline-offset-4"
          >
            {isRegistering ? "Sign in" : "Sign up"}
          </button>
        </div>
      </div>
      
      <form onSubmit={handleSubmit}>
        <div className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              className="bg-[#1C1C1C] border-white/10"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="bg-[#1C1C1C] border-white/10"
              required
            />
          </div>
          {error && (
            <div className="text-sm text-red-500">
              {error}
            </div>
          )}
          <Button
            type="submit"
            className="w-full bg-white/10 hover:bg-white/20 text-white"
            disabled={!username || !password}
          >
            {isRegistering ? "Sign up" : "Sign in"}
          </Button>
        </div>
      </form>
    </div>
  )
}

export function Sidebar({ className, onHistoryItemClick }: SidebarProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAuthPanel, setShowAuthPanel] = useState(false)

  useEffect(() => {
    // Check for existing token on mount
    const token = localStorage.getItem('auth_token')
    if (token) {
      setIsAuthenticated(true)
      fetchUserHistory()
    }
  }, [])

  const handleLoginSubmit = async (username: string, password: string) => {
    try {
      const response = await fetch('/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          username,
          password,
        }),
      })

      const data = await response.json()
      if (response.ok) {
        localStorage.setItem('auth_token', data.access_token)
        setIsAuthenticated(true)
        setError(null)
        setUsername(username)
        fetchUserHistory()
      } else {
        // Handle structured error response
        const errorMessage = typeof data.detail === 'string' 
          ? data.detail 
          : Array.isArray(data.detail)
          ? data.detail[0]?.msg || 'Login failed'
          : 'Login failed'
        setError(errorMessage)
      }
    } catch (err) {
      setError('Failed to connect to server')
      console.error('Login error:', err)
    }
  }

  const handleRegisterSubmit = async (username: string, password: string) => {
    try {
      const response = await fetch('/auth/register?' + new URLSearchParams({
        username,
        password,
        email: ''  // Optional email as empty string
      }), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })

      const data = await response.json()
      if (response.ok) {
        localStorage.setItem('auth_token', data.access_token)
        setIsAuthenticated(true)
        setError(null)
        setUsername(username)
        fetchUserHistory()
      } else {
        // Handle structured error response
        const errorMessage = typeof data.detail === 'string' 
          ? data.detail 
          : Array.isArray(data.detail)
          ? data.detail[0]?.msg || 'Registration failed'
          : 'Registration failed'
        setError(errorMessage)
      }
    } catch (err) {
      setError('Failed to connect to server')
      console.error('Registration error:', err)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('auth_token')
    setIsAuthenticated(false)
    setUsername('')
    setPassword('')
    setHistory([])
  }

  const fetchUserHistory = async () => {
    const token = localStorage.getItem('auth_token')
    if (!token) return

    try {
      const response = await fetch('/api/v1/query_history', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      if (response.ok) {
        const data = await response.json()
        if (data.status === 'success' && data.data?.queries) {
          setHistory(data.data.queries)
        }
      } else {
        console.error('Failed to fetch history:', await response.text())
      }
    } catch (err) {
      console.error('Failed to fetch history:', err)
    }
  }

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-[#0D0D0D]">
      {/* Top Navigation */}
      <div className="p-4 space-y-2">
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-white/60 hover:text-white text-lg mb-6"
          onClick={() => window.location.href = '/'}
        >
          <Hexagon className="h-5 w-5" />
          Orbit LM
        </Button>

        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-[15px] font-medium text-white/60 hover:text-white"
          onClick={() => {
            window.location.href = '/'
            // Clear any existing thread state here
          }}
        >
          <Plus className="h-5 w-5" />
          New Analysis
        </Button>

        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-[15px] font-medium text-white/60 hover:text-white"
        >
          <Users className="h-5 w-5" />
          Discover
        </Button>

        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-[15px] font-medium text-white/60 hover:text-white"
        >
          <HistoryIcon className="h-5 w-5" />
          History
        </Button>
      </div>

      {/* History Section */}
      <div className="flex-1 overflow-y-auto px-2">
        {isAuthenticated && history.map((item) => (
          <Button
            key={item.id}
            variant="ghost"
            className="w-full justify-start text-left text-sm text-white/60 hover:text-white truncate px-3 py-2 rounded-lg"
            onClick={() => {
              onHistoryItemClick?.(item.thread)
              setIsOpen(false)
            }}
          >
            {item.title}
          </Button>
        ))}
      </div>

      {/* Bottom Section */}
      <div className="mt-auto px-4 pb-16 space-y-4">
        {/* Auth Section */}
        {!isAuthenticated ? (
          <div className="rounded-xl border border-white/10 overflow-hidden">
            {showAuthPanel ? (
              <LoginForm
                onLogin={handleLoginSubmit}
                onRegister={handleRegisterSubmit}
                error={error}
              />
            ) : (
              <div className="p-4">
                <div className="text-base font-medium mb-1">Subscribe to save history</div>
                <div className="text-sm text-white/60 mb-3">
                  Sign in to access your analysis history and preferences.
                </div>
                <Button
                  variant="outline"
                  className="w-full justify-center gap-2"
                  onClick={() => setShowAuthPanel(true)}
                >
                  <LogIn className="h-4 w-4" />
                  Sign in
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between px-2 py-1">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
                {username.slice(0, 2).toUpperCase()}
              </div>
              <div className="text-sm text-white/60">{username}</div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="text-white/60 hover:text-white"
              onClick={handleLogout}
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Enterprise Upgrade Section */}
        <div className="rounded-xl border border-white/10 p-4 space-y-2">
          <div className="text-base font-medium">Try Enterprise</div>
          <div className="text-sm text-white/60">
            Upgrade for advanced analysis and more features.
          </div>
          <Button
            variant="ghost"
            className="w-full justify-between text-sm text-white/60 hover:text-white mt-2"
          >
            Learn More
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )

  // Desktop sidebar
  const DesktopSidebar = () => (
    <div className="hidden md:block w-[260px] bg-[#0D0D0D] border-r border-white/10">
      <SidebarContent />
    </div>
  )

  // Mobile sidebar
  const MobileSidebar = () => (
    <div className="md:hidden">
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="md:hidden fixed top-4 left-4 z-50">
            <Menu className="h-6 w-6" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-[80%] max-w-[300px] p-0 bg-[#0D0D0D] border-r border-white/10">
          <SidebarContent />
        </SheetContent>
      </Sheet>
    </div>
  )

  return (
    <>
      <DesktopSidebar />
      <MobileSidebar />
    </>
  )
}
