
import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, UserRole } from '@/types';
import { toast } from '@/hooks/use-toast';

// Mock users for demonstration
const MOCK_USERS = [
  {
    id: '1',
    email: 'admin@workwise.com',
    password: 'admin123',
    name: 'Admin User',
    role: UserRole.AUTHOR,
    avatarUrl: '',
  },
  {
    id: '2',
    email: 'employee@workwise.com',
    password: 'employee123',
    name: 'Demo Employee',
    role: UserRole.EMPLOYEE,
    avatarUrl: '',
  }
];

interface AuthContextType {
  currentUser: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  register: (name: string, email: string, password: string, role: UserRole) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  const isAuthenticated = !!currentUser;
  
  useEffect(() => {
    // Check for stored user on initial load
    const storedUser = localStorage.getItem('workwise_user');
    if (storedUser) {
      try {
        setCurrentUser(JSON.parse(storedUser));
      } catch (error) {
        console.error('Failed to parse stored user:', error);
        localStorage.removeItem('workwise_user');
      }
    }
    setIsLoading(false);
  }, []);

  const login = async (email: string, password: string): Promise<boolean> => {
    setIsLoading(true);
    
    try {
      // Simulate API call with delay
      await new Promise(resolve => setTimeout(resolve, 800));
      
      const user = MOCK_USERS.find(
        u => u.email === email && u.password === password
      );
      
      if (user) {
        // Remove password from user object before storing
        const { password: _, ...userWithoutPassword } = user;
        setCurrentUser(userWithoutPassword);
        localStorage.setItem('workwise_user', JSON.stringify(userWithoutPassword));
        toast({
          title: "Login successful",
          description: `Welcome back, ${userWithoutPassword.name}!`
        });
        return true;
      } else {
        toast({
          variant: "destructive",
          title: "Login failed",
          description: "Invalid email or password. Please try again.",
        });
        return false;
      }
    } catch (error) {
      console.error('Login error:', error);
      toast({
        variant: "destructive",
        title: "Login error",
        description: "An unexpected error occurred. Please try again.",
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    setCurrentUser(null);
    localStorage.removeItem('workwise_user');
    navigate('/login');
    toast({
      title: "Logged out",
      description: "You have been successfully logged out."
    });
  };

  const register = async (
    name: string, 
    email: string, 
    password: string, 
    role: UserRole
  ): Promise<boolean> => {
    setIsLoading(true);
    
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Check if email already exists
      if (MOCK_USERS.some(user => user.email === email)) {
        toast({
          variant: "destructive",
          title: "Registration failed",
          description: "Email already in use. Please use a different email.",
        });
        return false;
      }
      
      // Create new user object
      const newUser = {
        id: `user_${Math.random().toString(36).substring(2, 9)}`,
        name,
        email,
        password, // In a real app, this would be hashed
        role,
        avatarUrl: '',
      };
      
      // In a real app, we would save to database here
      MOCK_USERS.push(newUser);
      
      // Login the user after registration
      const { password: _, ...userWithoutPassword } = newUser;
      setCurrentUser(userWithoutPassword);
      localStorage.setItem('workwise_user', JSON.stringify(userWithoutPassword));
      
      toast({
        title: "Registration successful",
        description: `Welcome, ${name}!`,
      });
      
      return true;
    } catch (error) {
      console.error('Registration error:', error);
      toast({
        variant: "destructive",
        title: "Registration error",
        description: "An unexpected error occurred. Please try again.",
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const value = {
    currentUser,
    isAuthenticated,
    isLoading,
    login,
    logout,
    register
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
