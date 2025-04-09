
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';

const Profile: React.FC = () => {
  const { currentUser } = useAuth();

  if (!currentUser) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <p>Please log in to view your profile.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">My Profile</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle>Profile Information</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center text-center">
            <Avatar className="w-24 h-24 mb-4">
              <AvatarImage src={currentUser.avatarUrl} alt={currentUser.name} />
              <AvatarFallback className="text-2xl">{currentUser.name?.charAt(0) || 'U'}</AvatarFallback>
            </Avatar>
            <h3 className="text-xl font-medium">{currentUser.name}</h3>
            <p className="text-muted-foreground">{currentUser.email}</p>
            <p className="mt-2 capitalize text-sm bg-primary/10 text-primary px-2 py-1 rounded-full">
              {currentUser.role.toLowerCase()}
            </p>
            <Button variant="outline" className="mt-4">
              Edit Profile
            </Button>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Account Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="font-medium">Full Name</div>
              <div className="text-muted-foreground">{currentUser.name}</div>
            </div>
            <div>
              <div className="font-medium">Email Address</div>
              <div className="text-muted-foreground">{currentUser.email}</div>
            </div>
            <div>
              <div className="font-medium">Role</div>
              <div className="text-muted-foreground capitalize">{currentUser.role.toLowerCase()}</div>
            </div>
            <div>
              <div className="font-medium">Member Since</div>
              <div className="text-muted-foreground">April 2025</div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Profile;
