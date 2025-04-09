
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreditCard, Download, Plus } from 'lucide-react';

const invoices = [
  {
    id: 'INV-001',
    date: '2025-04-01',
    amount: 499.99,
    status: 'paid'
  },
  {
    id: 'INV-002',
    date: '2025-03-01',
    amount: 499.99,
    status: 'paid'
  },
  {
    id: 'INV-003', 
    date: '2025-02-01',
    amount: 499.99,
    status: 'paid'
  },
];

const Payments: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Payments</h1>
          <p className="text-muted-foreground">Manage your billing and payment information</p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add Payment Method
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Subscription</CardTitle>
            <CardDescription>Manage your subscription plan</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-primary/10 p-4 rounded-lg">
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-medium">Pro Plan</h3>
                <Badge>Active</Badge>
              </div>
              <div className="text-2xl font-bold">$499.99<span className="text-sm font-normal text-muted-foreground">/month</span></div>
              <p className="text-sm text-muted-foreground mt-1">Renews on May 1, 2025</p>
            </div>
            <div className="flex gap-4">
              <Button variant="outline" className="flex-1">Upgrade Plan</Button>
              <Button variant="outline" className="flex-1">Cancel Subscription</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payment Methods</CardTitle>
            <CardDescription>Manage your payment methods</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="border p-4 rounded-lg flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CreditCard className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium">Visa ending in 1234</p>
                  <p className="text-sm text-muted-foreground">Expires 12/28</p>
                </div>
              </div>
              <Badge>Default</Badge>
            </div>
            <Button variant="outline" className="w-full">
              <Plus className="mr-2 h-4 w-4" />
              Add Payment Method
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Billing History</CardTitle>
          <CardDescription>View and download your past invoices</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <div className="grid grid-cols-4 bg-muted/50 p-4 font-medium">
              <div>Invoice</div>
              <div>Date</div>
              <div>Amount</div>
              <div className="text-right">Status</div>
            </div>
            {invoices.map((invoice) => (
              <div key={invoice.id} className="grid grid-cols-4 p-4 border-t items-center">
                <div className="flex items-center gap-2">
                  {invoice.id}
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
                <div>{new Date(invoice.date).toLocaleDateString()}</div>
                <div>${invoice.amount.toFixed(2)}</div>
                <div className="text-right">
                  <Badge variant={invoice.status === 'paid' ? "success" : "default"}>
                    {invoice.status === 'paid' ? 'Paid' : 'Pending'}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Payments;
