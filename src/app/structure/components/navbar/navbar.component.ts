import { Component, OnInit } from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-navbar',
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.scss']
})
export class NavbarComponent implements OnInit {
  isAuthenticated$!: Observable<boolean>;
  userProfile$!: Observable<any>;
  authEnabled = environment.authEnabled;

  constructor(public authService: AuthService) {}

  ngOnInit(): void {
    if (this.authEnabled) {
      this.isAuthenticated$ = this.authService.isAuthenticated$;
      this.userProfile$ = this.authService.userProfile$;
    }
  }

  login(): void {
    this.authService.login();
  }

  logout(): void {
    this.authService.logout();
  }
}
